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
- [A100](#a100)
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

Each thread runs every instruction in the listing. The GPU runs the threads of a block in groups of 32, called warps, and the 32 threads of a warp run each instruction together. The values `c[0x0][...]` come from a small read-only memory called constant memory. It holds the kernel's arguments `n`, `a`, `x` and `y` and the block size, and every thread reads the same values from it. The register `R5` holds 4, the size of a 32-bit number in bytes, which is set by one of the setup instructions.

The kernel does two loads and one store for each `FFMA`, so it is [memory bound]({{ '/notes/gpu.html#memory-bandwidth' | relative_url }}).{% include components/sidenote.html id="sn-ffma" label="1" text="`FFMA` is a fused multiply-add. It computes `x[i] · a + y[i]` in one instruction and rounds the result only once. The listed FP32 speed of a GPU counts each `FFMA` as 2 operations, so the speed is 2 × FP32 cores × clock." %}

## A100

The kernels in this note run on an NVIDIA A100 with 40 GB of memory.

| Part | A100 |
|---|---|
| SMs | 108 |
| FP32 cores per SM | 64 |
| Clock | 1,410 MHz |
| FP32 speed | 108 SMs × 64 cores × 2 operations per `FFMA` × 1.41 GHz, which is 19.49 trillion operations per second |
| HBM bandwidth | 1,555 GB/s |
| L2 cache | 40 MB |
| Shared memory per SM | Up to 164 KB |

The number of floating point operations (FLOPs) that a kernel does for each byte it moves to or from HBM is called its arithmetic intensity. A kernel with a low arithmetic intensity waits on HBM, so its best speed is 1,555 GB per second times its FLOPs per byte. A kernel with a high arithmetic intensity waits on the FP32 cores instead, and its best speed is 19.49 TFLOPS, which means 19.49 trillion FLOPs per second. The two limits meet at 19.49 TFLOPS ÷ 1,555 GB per second = 12.5 FLOPs per byte, which is called the ridge point. A 32-bit number is 4 bytes, so a kernel needs about 50 operations for each number that it moves to keep the FP32 cores busy.

[![Highest possible FP32 speed on the A100 against FLOPs per byte moved, on log scales. The speed rises with FLOPs per byte up to the ridge point at 12.5, then stays flat at 19.49 TFLOPS]({{ '/assets/images/roofline.svg' | relative_url }}){: .ia-gpu-overview}]({{ '/assets/images/roofline.svg' | relative_url }})

## Matrix multiplication

A matrix multiplication `C = A · B` takes a matrix `A` with M rows and K columns and a matrix `B` with K rows and N columns. The result `C` has M rows and N columns. Each element `C[i][j]` is the sum of K products, which pair the numbers of row `i` of `A` with the numbers of column `j` of `B`.

[![C = A · B, where element (i, j) of C comes from row i of A and column j of B, and a 3 by 4 matrix stored in row-major order]({{ '/assets/images/matmul.svg' | relative_url }}){: .ia-gpu-overview}]({{ '/assets/images/matmul.svg' | relative_url }})

A program stores a matrix in memory as one long list. In row-major order the rows come one after another, so element `(r, c)` of a matrix with K columns is at place `r × K + c`. The kernels below use row-major order for all three matrices.

The size in this note is M = N = K = 4096. `C` has 4096 × 4096 elements, and each one needs 4,096 multiplications and 4,096 additions, so the whole product is 2 × 4096³, which is about 137 billion operations. At 19.49 trillion operations per second, the A100 needs at least 7.05 ms.

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

Kernel 1 gives the right answer, but it is 34 to 65 times slower than cuBLAS. The reason is the way its warps read memory, which depends on which threads of a block share a warp. The hardware numbers each thread of a block `x + y × blockDim.x`, so `x` changes fastest, and each run of 32 numbers in a row, e.g., 0 to 31, is one warp. In a block of 16 by 16 threads, a warp is 2 rows of 16 threads, and in a block of 32 by 32 threads, a warp is one row of 32 threads.

[![The threads of a 16 by 16 block, where each warp is 2 rows, and of a 32 by 32 block, where each warp is 1 row]({{ '/assets/images/cuda-warps.svg' | relative_url }}){: .ia-gpu-overview}]({{ '/assets/images/cuda-warps.svg' | relative_url }})

The threads of a warp read memory together. The memory system moves data in pieces of 32 bytes, called sectors, so a read of one 4-byte number still moves 32 bytes. When several threads of a warp read numbers in the same sector, the GPU moves that sector only once for all of them.

In a 32 by 32 block, the 32 threads of a warp have `threadIdx.x` from 0 to 31 and the same `threadIdx.y`. Kernel 1 takes the row of `C` from x, so the warp works on 32 rows of `C` in one column. At each step `k` of the loop, the 32 threads read `A[i][k]` from 32 different rows of `A`. A row of `A` holds 4,096 numbers, which is 16 KB, so each of the 32 numbers is in its own sector. The warp moves 32 sectors to use 4 bytes from each of them. All 32 threads read the same `B[k][j]`, which is one more sector, so the warp moves 33 sectors at each step.

[![Kernel 1 at one step k: the warp is 32 rows of one column of C. It reads one number from each of 32 rows of A, and each of those numbers needs its own 32-byte sector, plus one number of B, for 33 sectors in all]({{ '/assets/images/matmul-kernel1.svg' | relative_url }}){: .ia-gpu-overview}]({{ '/assets/images/matmul-kernel1.svg' | relative_url }})

In a 16 by 16 block, a warp works on 16 rows and 2 columns of `C`. It reads `A` from 16 rows, and its two numbers of `B` sit next to each other in one sector, so the warp moves 17 sectors at each step. The 16 by 16 blocks move about half as many sectors as the 32 by 32 blocks, and they took about half the time.{% include components/sidenote.html id="sn-ratio" label="2" text="The two times differ by 471 / 243 = 1.94, and the two counts of sectors differ by 33 / 17 = 1.94. The speed of kernel 1 is set almost entirely by the number of sectors that its warps move." %}

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

Kernel 2 still reaches only 16% of cuBLAS. Each `FFMA` in its loop needs two numbers from memory, which is 2 FLOPs for 8 bytes, or 0.25 FLOPs per byte. The ridge point is 12.5 FLOPs per byte, so kernel 2 does far too little math for each byte that it loads.

## Kernel 3: shared memory

In kernel 2, threads in the same block read the same numbers again and again. For example, all the threads in one row of a block need the same row of `A`, and each of them reads it from global memory on its own. Global memory is the memory in HBM that every thread can reach, with the L2 cache in front of it. In kernel 3, the threads of a block copy a piece of `A` and a piece of `B` into shared memory together, and then each thread reads the numbers it needs from there.

Each block computes one square tile of `C`. The rows of that tile need the same rows of `A`, and its columns need the same columns of `B`, so the block works through a strip of `A` and a strip of `B`. It cuts both strips into tiles of the same size as its tile of `C`, and at each step it does four things:

1. The threads copy the current tile of `A` and the current tile of `B` into shared memory, and each thread copies one number of each.
2. The threads wait until both tiles are complete.
3. Each thread multiplies its row of the `A` tile with its column of the `B` tile, and adds the result to its sum.
4. The block moves to the next tile of each strip, which is to the right in `A` and down in `B`.

[![Kernel 3 at step i = 1: the block computes one tile of C. Tile i of its strip of A is in shared memory as s_A and tile i of its strip of B as s_B. Row ty of s_A and column tx of s_B line up with element (tx, ty) of the C tile. At the next step, the tile of A moves right and the tile of B moves down, and after the last step the C tile holds the sum of all the tile products]({{ '/assets/images/matmul-kernel3.svg' | relative_url }}){: .ia-gpu-overview}]({{ '/assets/images/matmul-kernel3.svg' | relative_url }})

Each element of `C` is a sum over `k`, and each pair of tiles covers one stretch of `k`, so each step adds one part of every sum in the tile. When the block reaches the end of the strips, each thread has added all the parts, and its sum is its element of `C`.

Here is the kernel with 32 by 32 tiles, without the bounds checks, which matter only when M, N or K isn't a multiple of 32:

```cpp
__global__ void sgemm_3(const float* A, const float* B, float* C, int M, int K, int N) {
    __shared__ float s_A[32][32];
    __shared__ float s_B[32][32];

    int tx = threadIdx.x, ty = threadIdx.y;
    int row = blockIdx.y * 32 + ty;
    int col = blockIdx.x * 32 + tx;

    float tmp = 0.0f;
    for (int i = 0; i < K / 32; i++) {
        s_A[ty][tx] = A[row * K + i * 32 + tx];
        s_B[ty][tx] = B[(i * 32 + ty) * N + col];
        __syncthreads();
        for (int j = 0; j < 32; j++) {
            tmp += s_A[ty][j] * s_B[j][tx];
        }
        __syncthreads();
    }
    C[row * N + col] = tmp;
}
```

Each thread computes the element at `row` and `col` of `C`, and the loop variable `i` counts the steps. The word `__shared__` puts an array in shared memory, with one copy for each block. A call to `__syncthreads()` makes each thread of the block wait until all of them have reached it. The first call makes sure that both tiles are complete before any thread reads them, and the second makes sure that every thread is done with the tiles before the next step overwrites them. Both copies from global memory are coalesced, because the threads of a warp have neighboring `tx` and read neighboring numbers in one row of `A` or `B`.

Kernel 3 took 25.82 ms, which is 5.32 TFLOPS and 1.75 times faster than kernel 2.

### How much of an SM a block uses

Each block has 1,024 threads and keeps two 32 by 32 tiles in shared memory, which take 8 KB. An SM holds at most 2,048 threads, so it runs 2 blocks at a time and uses 16 KB of its 164 KB of shared memory.

The tile can't get bigger while each thread computes one element of `C`, because a block can have at most 1,024 threads, and a 32 by 32 tile already needs all of them.

### Operations and loads

At each step, each thread does 32 `FFMA`s, one for each pair of numbers in its row of `s_A` and its column of `s_B`. Three parts of the GPU each set a highest possible speed for kernel 3:

1. The FP32 cores. If they ran an `FFMA` in every cycle, the kernel would reach the full FP32 speed of 19.49 TFLOPS.
2. Global memory. At each step, each thread loads two numbers from global memory, one for `s_A` and one for `s_B`, which is 8 bytes. It then does 32 `FFMA`s, which is 64 FLOPs, so kernel 3 does 64 / 8 = 8 FLOPs for each byte that it loads, which is 32 times the 0.25 FLOPs per byte of kernel 2. The factor of 32 comes from sharing, because each number in `s_A` is used by the 32 threads in its row of the tile, and each number in `s_B` by the 32 threads in its column. Even if every load went to HBM, the ridge point graph would allow 8 × 1,555 GB per second = 12.4 TFLOPS, and the L2 cache serves many of the loads, so the real limit is higher.
3. Shared memory. A warp runs each instruction for all 32 of its threads at once, so the counts below are for one warp. One warp `FFMA` does 32 multiply-adds, one for each thread. One warp load from shared memory gives one number to each of the 32 threads, which is 32 numbers. In the compiled code, a warp runs these instructions at each step:
   - 32 `FFMA`s.
   - 32 loads from `s_B`. Each one gives every thread the next number of its column.
   - 8 loads from `s_A`. Each one gives every thread four numbers of its row at once.

   The 64 FP32 cores of an SM finish 2 warp `FFMA`s per cycle, so the 32 `FFMA`s need 16 cycles. Shared memory has 32 banks that each give out one 4-byte number per cycle, which is 32 numbers per cycle, or one warp load. The 40 loads therefore need at least 40 cycles. While shared memory works through those 40 cycles, the FP32 cores are busy for only 16 of them, so the kernel can reach at most 16 / 40 = 40% of the FP32 speed, or about 7.8 TFLOPS. The 40% is an estimate, because it counts each load as exactly one cycle of shared memory.

<details markdown="1">
<summary>SASS of one step of the loop</summary>

Kernel 3 for the A100 (`-O3 -arch=sm_80`), from Compiler Explorer. It was compiled with the bounds checks, which add the `ISETP` and `@!P` instructions at the top. The two `LDG` loads and two `STS` stores copy the tiles, the two `BAR` instructions are the `__syncthreads()` calls, and between them are the 32 `LDS`, 8 `LDS.128` and 32 `FFMA` instructions.

```
.L_x_1:
ISETP.GE.AND P1, PT, R16, c[0x0][0x17c], PT
HFMA2.MMA R29, -RZ, RZ, 0, 0
ISETP.GE.AND P2, PT, R17, c[0x0][0x17c], PT
ISETP.GE.OR P1, PT, R18, c[0x0][0x180], P1
ISETP.GE.OR P2, PT, R19, c[0x0][0x178], P2
MOV R26, RZ
@!P1 MOV R24, 0x4
@!P2 MOV R8, R6
@!P2 MOV R9, R3
@!P1 IMAD.WIDE R24, R5, R24, c[0x0][0x168]
@!P2 LDG.E R29, [R8.64]
@!P1 LDG.E R26, [R24.64]
UIADD3 UR4, UR4, 0x1, URZ
IADD3 R6, P2, R6, 0x80, RZ
IADD3 R16, R16, 0x20, RZ
IADD3 R17, R17, 0x20, RZ
ISETP.LE.AND P1, PT, R7, UR4, PT
IADD3.X R3, RZ, R3, RZ, P2, !PT
STS [R0], R29
STS [R0+0x1000], R26
BAR.SYNC.DEFER_BLOCKING 0x0
LDS R28, [R4]
LDS.128 R12, [R2]
LDS R26, [R4+0x80]
LDS R27, [R4+0x100]
LDS R20, [R4+0x180]
LDS R21, [R4+0x200]
LDS.128 R8, [R2+0x10]
LDS R22, [R4+0x280]
LDS R25, [R4+0x300]
LDS R24, [R4+0x380]
FFMA R12, R28, R12, R23
LDS R23, [R4+0x400]
FFMA R12, R26, R13, R12
FFMA R12, R27, R14, R12
FFMA R26, R20, R15, R12
LDS.128 R12, [R2+0x20]
LDS R20, [R4+0x480]
FFMA R8, R21, R8, R26
LDS R21, [R4+0x500]
FFMA R8, R22, R9, R8
LDS R26, [R4+0x580]
FFMA R8, R25, R10, R8
LDS R25, [R4+0x600]
FFMA R24, R24, R11, R8
LDS.128 R8, [R2+0x30]
LDS R22, [R4+0x680]
FFMA R12, R23, R12, R24
LDS R23, [R4+0x700]
FFMA R12, R20, R13, R12
LDS R24, [R4+0x780]
FFMA R12, R21, R14, R12
LDS R21, [R4+0x800]
FFMA R26, R26, R15, R12
LDS.128 R12, [R2+0x40]
LDS R20, [R4+0x880]
FFMA R8, R25, R8, R26
LDS R25, [R4+0x900]
FFMA R8, R22, R9, R8
LDS R26, [R4+0x980]
LDS R22, [R4+0xa80]
FFMA R8, R23, R10, R8
LDS R23, [R4+0xa00]
FFMA R24, R24, R11, R8
LDS.128 R8, [R2+0x50]
FFMA R12, R21, R12, R24
LDS R21, [R4+0xb00]
FFMA R12, R20, R13, R12
LDS R20, [R4+0xb80]
FFMA R12, R25, R14, R12
LDS R25, [R4+0xc00]
FFMA R26, R26, R15, R12
LDS.128 R12, [R2+0x60]
LDS R24, [R4+0xc80]
FFMA R8, R23, R8, R26
LDS R23, [R4+0xd00]
FFMA R8, R22, R9, R8
LDS R22, [R4+0xd80]
FFMA R8, R21, R10, R8
LDS R21, [R4+0xe00]
FFMA R26, R20, R11, R8
LDS.128 R8, [R2+0x70]
LDS R20, [R4+0xe80]
FFMA R26, R25, R12, R26
LDS R25, [R4+0xf00]
FFMA R13, R24, R13, R26
LDS R12, [R4+0xf80]
FFMA R13, R23, R14, R13
HFMA2.MMA R14, -RZ, RZ, 0, 1.9073486328125e-06
FFMA R13, R22, R15, R13
IMAD R5, R14, c[0x0][0x180], R5
FFMA R8, R21, R8, R13
FFMA R8, R20, R9, R8
FFMA R8, R25, R10, R8
FFMA R23, R12, R11, R8
BAR.SYNC.DEFER_BLOCKING 0x0
@!P1 BRA `(.L_x_1)
```

</details>

| Limit | Highest speed |
|---|---|
| FP32 cores | 19.49 TFLOPS |
| Global memory, if every load went to HBM | 12.4 TFLOPS |
| Shared memory loads | about 7.8 TFLOPS |
| Measured | 5.32 TFLOPS |

Shared memory loads set the lowest limit, so the next kernel has to do more `FFMA`s for each number that it loads from shared memory.

## Results

All times are for M = N = K = 4096 with 32-bit numbers on the A100.

| Kernel | Time (ms) | TFLOPS | % of FP32 speed | % of cuBLAS |
|---|---|---|---|---|
| cuBLAS | 7.22 | 19.03 | 97.6% | 100% |
| 1, 16 × 16 blocks | 243.39 | 0.56 | 2.9% | 3.0% |
| 1, 32 × 32 blocks | 470.95 | 0.29 | 1.5% | 1.5% |
| 2, 32 × 32 blocks | 45.22 | 3.04 | 15.6% | 16.0% |
| 3, 32 × 32 tiles | 25.82 | 5.32 | 27.3% | 28.0% |
