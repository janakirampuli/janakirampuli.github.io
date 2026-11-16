---
layout: notes
title: "CUDA kernels and matrix multiplication"
description: "Writing GPU programs in CUDA: threads, blocks and grids in code, what the compiler makes of a kernel, how to time one, and the first matrix multiplication kernels measured on an A100."
date: 2026-11-15
tags: ["gpu", "cuda", "matmul"]
project: gpu-programming
part: 2
published: true
extra_css:
  - /assets/css/transformer.css
  - /assets/css/gpu.css
---

## Contents

<div class="ia-toc" markdown="1">

- [A kernel](#a-kernel)
- [Starting a kernel from the CPU](#starting-a-kernel-from-the-cpu)
- [From CUDA to machine instructions](#from-cuda-to-machine-instructions)
- [The A100](#the-a100)
- [Matrix multiplication](#matrix-multiplication)
- [The cuBLAS reference](#the-cublas-reference)
- [Kernel 1: one thread for each element](#kernel-1-one-thread-for-each-element)
- [Kernel 2: reading neighboring numbers](#kernel-2-reading-neighboring-numbers)
- [Kernel 3: shared memory](#kernel-3-shared-memory)
- [Results](#results)

</div>

## A kernel

A kernel is a function that runs on the GPU. The CPU starts it with a grid of blocks, and every thread in every block runs the whole function. Every thread runs the same code, so each thread needs a way to find its own part of the work. CUDA gives each thread four built-in values for that:

- `threadIdx` is the position of the thread inside its block.
- `blockIdx` is the position of the block inside the grid.
- `blockDim` is the size of each block, in threads.
- `gridDim` is the size of the grid, in blocks.

Each value has three parts, `.x`, `.y` and `.z`, because a block can lay out its threads in one, two or three dimensions, and a grid can do the same with its blocks. A program picks the layout that matches its data, e.g., one dimension for a list and two for a matrix. In the dimensions that a program doesn't use, the sizes are 1 and the positions are 0. A block can have up to 1,024 threads in all, whatever its layout.

[![A grid of 3 by 2 by 2 blocks. Block (2, 1, 0) is shown with its 4 by 3 by 2 threads, and thread (3, 1, 0) of that block is shown on its own with its threadIdx and blockIdx]({{ '/assets/images/cuda-hierarchy.svg' | relative_url }}){: .ia-gpu-overview}]({{ '/assets/images/cuda-hierarchy.svg' | relative_url }})

A list needs only the `.x` parts. Here is `y = a·x + y` as a kernel, where each thread works on one place in the lists:

```cpp
__global__ void saxpy(int n, float a, const float* x, float* y) {
    int i = blockIdx.x * blockDim.x + threadIdx.x;
    if (i < n) y[i] = a * x[i] + y[i];
}
```

The word `__global__` tells the compiler that the function runs on the GPU and that the CPU can start it. A kernel returns nothing, so it writes its results to memory.

Block 0 covers the first `blockDim.x` places, and block 1 covers the next `blockDim.x` places. A thread therefore finds its place `i` by skipping the places of all the blocks before its own, and then adding its number inside the block.

[![A grid of 3 blocks with 4 threads each, working on a list of 10 numbers. Each thread computes i from blockIdx.x, blockDim.x and threadIdx.x, and the last 2 threads have no number to work on]({{ '/assets/images/cuda-grid.svg' | relative_url }}){: .ia-gpu-overview}]({{ '/assets/images/cuda-grid.svg' | relative_url }})

The grid always has a whole number of blocks, so the last block can have threads past the end of the list. The check `if (i < n)` makes those threads do nothing, and without it they would read and write memory past the end of `x` and `y`.

## Starting a kernel from the CPU

The GPU has its own memory, the HBM, and a kernel can only read numbers that are in it. The program on the CPU therefore reserves space in GPU memory and copies the input there before it starts the kernel:

```cpp
float *d_x, *d_y;
cudaMalloc(&d_x, n * sizeof(float));
cudaMalloc(&d_y, n * sizeof(float));
cudaMemcpy(d_x, x, n * sizeof(float), cudaMemcpyHostToDevice);
cudaMemcpy(d_y, y, n * sizeof(float), cudaMemcpyHostToDevice);

int threads = 256;
int blocks = (n + threads - 1) / threads;
saxpy<<<blocks, threads>>>(n, 2.0f, d_x, d_y);

cudaMemcpy(y, d_y, n * sizeof(float), cudaMemcpyDeviceToHost);
```

`cudaMalloc` reserves memory on the GPU, and `cudaMemcpy` copies numbers between the CPU's memory and the GPU's memory. The names that start with `d_` hold addresses in GPU memory, which is a common habit in CUDA code. The line with `<<<blocks, threads>>>` starts the kernel with `blocks` blocks of `threads` threads each. The number of blocks is `n / threads` rounded up, so that every place gets a thread. For a list of 1,048,576 numbers, the grid has 4,096 blocks of 256 threads.

The CPU puts the kernel in the GPU's queue and goes on. The last `cudaMemcpy` waits until the kernel has finished, and then it copies the result back to the CPU.

## From CUDA to machine instructions

NVIDIA's compiler `nvcc` turns a kernel into machine instructions in two steps:

1. First, it writes the kernel in PTX, which is an instruction set that NVIDIA keeps the same across GPU generations.
2. Second, it turns the PTX into SASS, which is the machine instruction set of one GPU generation. The flag `-arch` picks the generation, e.g., `-arch=sm_80` for the A100.

Here is the SASS of the `saxpy` kernel for the A100, from Compiler Explorer, with a few setup instructions left out:

```
S2R          R4, SR_CTAID.X                  R4 = blockIdx.x
S2R          R3, SR_TID.X                    R3 = threadIdx.x
IMAD         R4, R4, c[0x0][0x0], R3         R4 = blockIdx.x · blockDim.x + threadIdx.x, which is i
ISETP.GE.AND P0, PT, R4, c[0x0][0x160], PT   P0 = (i >= n)
@P0 EXIT                                     threads with i >= n stop here
IMAD.WIDE    R2, R4, R5, c[0x0][0x168]       R2 = x + 4·i, the address of x[i]
IMAD.WIDE    R4, R4, R5, c[0x0][0x170]       R4 = y + 4·i, the address of y[i]
LDG.E        R2, [R2.64]                     load x[i] from memory
LDG.E        R7, [R4.64]                     load y[i] from memory
FFMA         R7, R2, c[0x0][0x164], R7       R7 = x[i] · a + y[i]
STG.E        [R4.64], R7                     store the new y[i]
EXIT
```

Each thread runs the 12 instructions, and the 32 threads of a warp run each instruction together. The values `c[0x0][...]` come from a small read-only memory called constant memory. It holds the kernel's arguments `n`, `a`, `x` and `y` and the block size, and every thread reads the same values from it. The register `R5` holds 4, the size of a 32-bit number in bytes, which is set by one of the setup instructions.

The kernel does two loads and one store for each `FFMA`, so it is [memory bound]({{ '/notes/gpu.html#memory-bandwidth' | relative_url }}).{% include components/sidenote.html id="sn-ffma" label="1" text="`FFMA` is a fused multiply-add. It computes `x[i] · a + y[i]` in one instruction and rounds the result only once. The listed FP32 speed of a GPU counts each `FFMA` as 2 operations, so the speed is 2 × FP32 cores × clock." %}

## The A100

The kernels in this note run on an NVIDIA A100 with 40 GB of memory.

| Part | A100 |
|---|---|
| SMs | 108 |
| FP32 cores per SM | 64 |
| Clock | 1,410 MHz |
| FP32 speed | 108 × 64 × 2 × 1.41 GHz, which is 19.49 trillion operations per second |
| HBM bandwidth | 1,555 GB/s |
| L2 cache | 40 MB |
| Shared memory per SM | Up to 164 KB |

The number of FLOPs that a kernel does for each byte it moves to or from HBM is called its arithmetic intensity. A kernel with a low arithmetic intensity waits on HBM, so its best speed is 1,555 GB per second times its FLOPs per byte. A kernel with a high arithmetic intensity waits on the FP32 cores instead, and its best speed is 19.49 TFLOPS. The two limits meet at 19.49 TFLOPS ÷ 1,555 GB per second = 12.5 FLOPs per byte, which is called the ridge point. A 32-bit number is 4 bytes, so a kernel needs about 50 operations for each number that it moves to keep the FP32 cores busy.

[![Highest possible FP32 speed on the A100 against FLOPs per byte moved, on log scales. The speed rises with FLOPs per byte up to the ridge point at 12.5, then stays flat at 19.49 TFLOPS]({{ '/assets/images/roofline.svg' | relative_url }}){: .ia-gpu-overview}]({{ '/assets/images/roofline.svg' | relative_url }})

## Matrix multiplication

A matrix multiplication `C = A · B` takes a matrix `A` with M rows and K columns and a matrix `B` with K rows and N columns. The result `C` has M rows and N columns. Each element `C[i][j]` is the sum of K products, which pair the numbers of row `i` of `A` with the numbers of column `j` of `B`.

[![C = A · B, where element (i, j) of C comes from row i of A and column j of B, and a 3 by 4 matrix stored in row-major order]({{ '/assets/images/matmul.svg' | relative_url }}){: .ia-gpu-overview}]({{ '/assets/images/matmul.svg' | relative_url }})

A program stores a matrix in memory as one long list. In row-major order the rows come one after another, so element `(r, c)` of a matrix with K columns is at place `r × K + c`. The kernels below use row-major order for all three matrices.

The size in this note is M = N = K = 4096. Each element of `C` needs 4,096 multiplications and 4,096 additions, so the whole product is 2 × 4096³, which is about 137 billion operations. At 19.49 trillion operations per second, the A100 needs at least 7.05 ms.

Each matrix holds about 16.8 million numbers, which take about 67 MB. If the A100 read each number of the three matrices from HBM only once, the reads would take about 0.13 ms, and the math would take about 55 times longer than the reads. A matrix multiply of this size can therefore keep the FP32 cores busy, as long as it reads each number from HBM a few times and [uses it many times]({{ '/notes/gpu.html#reusing-numbers' | relative_url }}).

## The cuBLAS reference

cuBLAS is NVIDIA's library for matrix math. Its function `cublasSgemm` multiplies two matrices of 32-bit numbers. It took 7.22 ms, which is 19.03 TFLOPS and 97.6% of the A100's FP32 speed. The kernels below are compared against it.

## Kernel 1: one thread for each element

The simplest kernel gives each element of `C` its own thread. `C` has rows and columns, so the kernel uses the `.x` and `.y` parts of the built-in values. Each thread takes its row `i` from the x parts and its column `j` from the y parts, and then it adds up the K products:

```cpp
__global__ void sgemm_1(const float* A, const float* B, float* C, int M, int K, int N) {
    int i = threadIdx.x + blockDim.x * blockIdx.x;
    int j = threadIdx.y + blockDim.y * blockIdx.y;
    if (i < M && j < N) {
        float tmp = 0.0f;
        for (int k = 0; k < K; k++) {
            tmp += A[k + K * i] * B[k * N + j];
        }
        C[j + i * N] = tmp;
    }
}
```

The CPU program gives the sizes of the blocks and the grid with the type `dim3`, which holds an x, a y and a z size:

```cpp
dim3 blockDim(32, 32);
dim3 gridDim(ceil_div(M, 32), ceil_div(N, 32));
sgemm_1<<<gridDim, blockDim>>>(d_A, d_B, d_C, M, K, N);
```

Each block has 32 by 32 threads, and `ceil_div` divides and rounds up, so the grid has a thread for every element of `C`. Each thread keeps its running sum in a register and writes to `C` only once at the end.

| Block | Time (ms) | TFLOPS | % of cuBLAS |
|---|---|---|---|
| 16 × 16 | 243.39 | 0.56 | 3.0% |
| 32 × 32 | 470.95 | 0.29 | 1.5% |

Kernel 1 gives the right answer, but it is 34 to 65 times slower than cuBLAS. The reason is the way its warps read memory, which depends on which threads of a block share a warp. The hardware numbers each thread of a block `x + y × blockDim.x`, so `x` changes fastest, and each run of 32 numbers is one warp. In a block of 16 by 16 threads, a warp is 2 rows of 16 threads, and in a block of 32 by 32 threads, a warp is one row of 32 threads.

[![The threads of a 16 by 16 block, where each warp is 2 rows, and of a 32 by 32 block, where each warp is 1 row]({{ '/assets/images/cuda-warps.svg' | relative_url }}){: .ia-gpu-overview}]({{ '/assets/images/cuda-warps.svg' | relative_url }})

The threads of a warp read memory together. The memory system moves data in pieces of 32 bytes, called sectors, so a read of one 4-byte number still moves 32 bytes. When several threads of a warp read numbers in the same sector, the GPU moves that sector only once for all of them.

In a 32 by 32 block, the 32 threads of a warp have `threadIdx.x` from 0 to 31 and the same `threadIdx.y`. Kernel 1 takes the row of `C` from x, so the warp works on 32 rows of `C` in one column. At each step `k`, they read `A[i][k]` from 32 different rows of `A`. A row of `A` holds 4,096 numbers, which is 16 KB, so each of the 32 numbers is in its own sector. The warp moves 32 sectors to use 4 bytes from each of them. All 32 threads read the same `B[k][j]`, which is one more sector, so the warp moves 33 sectors at each step.

[![Kernel 1 at one step k: the warp is 32 rows of one column of C. It reads one number from each of 32 rows of A, and each of those numbers needs its own 32-byte sector, plus one number of B, for 33 sectors in all]({{ '/assets/images/matmul-kernel1.svg' | relative_url }}){: .ia-gpu-overview}]({{ '/assets/images/matmul-kernel1.svg' | relative_url }})

In a 16 by 16 block, a warp is 16 rows and 2 columns. It reads `A` from 16 rows, and its two numbers of `B` sit next to each other in one sector, so the warp moves 17 sectors at each step. The 16 by 16 blocks move about half as many sectors as the 32 by 32 blocks, and they took about half the time.{% include components/sidenote.html id="sn-ratio" label="2" text="The two times differ by 471 / 243 = 1.94, and the two counts of sectors differ by 33 / 17 = 1.94. The speed of kernel 1 is set almost entirely by the number of sectors that its warps move." %}

## Kernel 2: reading neighboring numbers

Kernel 2 swaps the two indices, so the column `j` comes from x and the row `i` comes from y:

```cpp
int j = threadIdx.x + blockDim.x * blockIdx.x;
int i = threadIdx.y + blockDim.y * blockIdx.y;
```

The grid swaps too, with N / 32 blocks in x and M / 32 blocks in y.

A warp is now one row of `C` and 32 neighboring columns. At each step, all 32 threads read the same `A[i][k]`, which is one sector. They also read `B[k][j]` to `B[k][j + 31]`, which are 32 neighboring numbers that take 128 bytes, or 4 sectors. The warp moves 5 sectors at each step instead of 33. When the threads of a warp read neighboring addresses, so that the GPU serves them with only a few sectors, the reads are called coalesced.

[![Kernel 2 at one step k: the warp is 32 neighboring columns of one row of C. It reads one number of A, which is 1 sector, and 32 neighboring numbers in one row of B, which are 4 sectors, for 5 sectors in all]({{ '/assets/images/matmul-kernel2.svg' | relative_url }}){: .ia-gpu-overview}]({{ '/assets/images/matmul-kernel2.svg' | relative_url }})

Kernel 2 took 45.22 ms, which is 3.04 TFLOPS and 10.4 times faster than kernel 1 with the same blocks.

Kernel 2 still reaches only 16% of cuBLAS. Each `FFMA` in its loop needs two numbers from memory, so the loop does about one operation for each number that it loads.

## Kernel 3: shared memory

WIP.

## Results

All times are for M = N = K = 4096 with 32-bit numbers on the A100.

| Kernel | Time (ms) | TFLOPS | % of FP32 speed | % of cuBLAS |
|---|---|---|---|---|
| cuBLAS | 7.22 | 19.03 | 97.6% | 100% |
| 1, 16 × 16 blocks | 243.39 | 0.56 | 2.9% | 3.0% |
| 1, 32 × 32 blocks | 470.95 | 0.29 | 1.5% | 1.5% |
| 2, 32 × 32 blocks | 45.22 | 3.04 | 15.6% | 16.0% |
