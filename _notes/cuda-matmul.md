---
layout: notes
title: "CUDA kernels and matrix multiplication"
description: "Writing GPU programs in CUDA: threads, blocks and grids in code, what the compiler makes of a kernel, how to time one, and the first matrix multiplication kernels measured on a B200."
date: 2026-11-22
tags: ["gpu", "cuda", "matmul"]
project: gpu-programming
part: 2
published: true
extra_css:
  - /assets/css/transformer.css
  - /assets/css/gpu.css
---

This work log is completely inspired by [Simon Boehm's blog](https://siboehm.com/articles/22/CUDA-MMM), and all the techniques here are from his work log.

## Contents

<div class="ia-toc" markdown="1">

- [A kernel](#a-kernel)
- [Starting a kernel from the CPU](#starting-a-kernel-from-the-cpu)
- [From CUDA to machine instructions](#from-cuda-to-machine-instructions)
- [B200](#b200)
- [Matrix multiplication](#matrix-multiplication)
- [The cuBLAS reference](#the-cublas-reference)
- [Kernel 1: one thread for each element](#kernel-1-one-thread-for-each-element)
- [Kernel 2: reading neighboring numbers](#kernel-2-reading-neighboring-numbers)
- [Kernel 3: shared memory](#kernel-3-shared-memory)
- [Kernel 4: a column of results for each thread](#kernel-4-a-column-of-results-for-each-thread)
- [Kernel 5: a square of results for each thread](#kernel-5-a-square-of-results-for-each-thread)
- [Kernel 6: vectorized loads](#kernel-6-vectorized-loads)
- [Kernel 7: transposing s_A](#kernel-7-transposing-s_a)
- [Kernel 8: double buffering](#kernel-8-double-buffering)
- [Kernel 9: warp tiling](#kernel-9-warp-tiling)
- [Results](#results)
- [References](#references)

</div>

## A kernel

A kernel is a function that runs on the GPU. The CPU starts it with a grid of blocks, and every thread in every block runs the whole function, so each thread needs a way to find its own part of the work. CUDA gives each thread four built-in values for that:

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

`cudaMalloc` reserves memory on the GPU, and `cudaMemcpy` copies numbers between the CPU's memory and the GPU's memory. The names that start with `d_` hold addresses in GPU memory. The line with `<<<blocks, threads>>>` starts the kernel with `blocks` blocks of `threads` threads each. The number of blocks is `n / threads` rounded up, so that every place gets a thread. For a list of 1,048,576 numbers, the grid has 4,096 blocks of 256 threads.

The CPU puts the kernel in the GPU's queue and goes on. The last `cudaMemcpy` waits until the kernel has finished, and then it copies the result back to the CPU.

## From CUDA to machine instructions

NVIDIA's compiler `nvcc` turns a kernel into machine instructions in two steps:

1. First, it writes the kernel in PTX, which is an instruction set that NVIDIA keeps the same across GPU generations.
2. Second, it turns the PTX into SASS, which is the machine instruction set of one GPU generation. The flag `-arch` picks the generation, e.g., `-arch=sm_100` for the B200.

Here is the SASS of the `saxpy` kernel for the B200 (`-arch=sm_100`), from `cuobjdump -sass`, with two setup instructions left out:

```
S2R          R0, SR_TID.X                    R0 = threadIdx.x
S2UR         UR4, SR_CTAID.X                 UR4 = blockIdx.x
LDCU         UR5, c[0x0][0x380]              UR5 = n
LDC          R7, c[0x0][0x360]               R7 = blockDim.x
IMAD         R7, R7, UR4, R0                 R7 = blockDim.x · blockIdx.x + threadIdx.x, which is i
ISETP.GE.AND P0, PT, R7, UR5, PT             P0 = (i >= n)
@P0 EXIT                                     threads with i >= n stop here
LDC.64       R2, c[0x0][0x388]               R2 = x
LDCU         UR6, c[0x0][0x384]              UR6 = a
LDC.64       R4, c[0x0][0x390]               R4 = y
IMAD.WIDE    R2, R7, 0x4, R2                 R2 = x + 4·i, the address of x[i]
LDG.E        R2, desc[UR4][R2.64]            load x[i] from memory
IMAD.WIDE    R4, R7, 0x4, R4                 R4 = y + 4·i, the address of y[i]
LDG.E        R7, desc[UR4][R4.64]            load y[i] from memory
FFMA         R7, R2, UR6, R7                 R7 = x[i] · a + y[i]
STG.E        desc[UR4][R4.64], R7            store the new y[i]
EXIT
```

Each thread runs every instruction in the listing. The GPU runs the threads of a block in groups of 32, called warps, and the 32 threads of a warp run each instruction together. The values `c[0x0][...]` come from a small read-only memory called constant memory. It holds the kernel's arguments `n`, `a`, `x` and `y` and the block size, and every thread reads the same values from it. `LDC` and `LDCU` load these values into registers, and a register whose name starts with `UR` is a uniform register, which holds one value for the whole warp, e.g., `blockIdx.x` or `a`. The `desc[UR4]` in a load or a store is a memory descriptor, which one of the setup instructions puts into `UR4` once `blockIdx.x` is no longer needed. The `0x4` is the size of a 32-bit number in bytes.

The kernel does two loads and one store for each `FFMA`, so it is [memory bound]({{ '/notes/gpu.html#memory-bandwidth' | relative_url }}).{% include components/sidenote.html id="sn-ffma" label="1" text="`FFMA` is a fused multiply-add. It computes `x[i] · a + y[i]` in one instruction and rounds the result only once. The listed FP32 speed of a GPU counts each `FFMA` as 2 operations, so the speed is 2 × FP32 cores × clock." %}

## B200

The kernels in this note run on an NVIDIA B200 with 192 GB of memory.

| Part | B200 |
|---|---|
| SMs | 148 |
| FP32 cores per SM | 128 |
| Clock | 1,965 MHz |
| FP32 speed | 148 SMs × 128 cores × 2 operations per `FFMA` × 1.965 GHz, which is 74.45 trillion operations per second |
| HBM bandwidth | 7,672 GB/s |
| L2 cache | 126.5 MB |
| Shared memory per SM | Up to 228 KB |

The number of floating point operations (FLOPs) that a kernel does for each byte it moves to or from HBM is called its arithmetic intensity. A kernel with a low arithmetic intensity waits on HBM, so its best speed is 7,672 GB per second times its FLOPs per byte. A kernel with a high arithmetic intensity waits on the FP32 cores instead, and its best speed is 74.45 TFLOPS, which means 74.45 trillion FLOPs per second. The two limits meet at 74.45 TFLOPS ÷ 7,672 GB per second = 9.7 FLOPs per byte, which is called the ridge point. A 32-bit number is 4 bytes, so a kernel needs about 39 operations for each number that it moves to keep the FP32 cores busy.

[![Highest possible FP32 speed on the B200 against FLOPs per byte moved, on log scales. The speed rises with FLOPs per byte up to the ridge point at 9.7, then stays flat at 74.45 TFLOPS]({{ '/assets/images/roofline.svg' | relative_url }}){: .ia-gpu-overview}]({{ '/assets/images/roofline.svg' | relative_url }})

## Matrix multiplication

A matrix multiplication `C = A · B` takes a matrix `A` with M rows and K columns and a matrix `B` with K rows and N columns. The result `C` has M rows and N columns. Each element `C[i][j]` is the sum of K products, which pair the numbers of row `i` of `A` with the numbers of column `j` of `B`.

[![C = A · B, where element (i, j) of C comes from row i of A and column j of B, and a 3 by 4 matrix stored in row-major order]({{ '/assets/images/matmul.svg' | relative_url }}){: .ia-gpu-overview}]({{ '/assets/images/matmul.svg' | relative_url }})

A program stores a matrix in memory as one long list. In row-major order the rows come one after another, so element `(r, c)` of a matrix with K columns is at place `r × K + c`. The kernels below use row-major order for all three matrices.

The size in this note is M = N = K = 4096. `C` has 4096 × 4096 elements, and each one needs 4,096 multiplications and 4,096 additions, so the whole product is 2 × 4096³, which is about 137 billion operations. At 74.45 trillion operations per second, the B200 needs at least 1.85 ms.

Each matrix holds about 16.8 million numbers, which take about 67 MB. If the B200 read each number of the three matrices from HBM only once, the reads would take about 0.026 ms, and the math would take about 70 times longer than the reads. A matrix multiply of this size can therefore keep the FP32 cores busy, as long as it reads each number from HBM a few times and [uses it many times]({{ '/notes/gpu.html#reusing-numbers' | relative_url }}).

## The cuBLAS reference

cuBLAS is NVIDIA's library for matrix math. Its function `cublasSgemm` multiplies two matrices of 32-bit numbers. It took 2.16 ms, which is 63.60 TFLOPS and 85.4% of the B200's FP32 speed.

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
| 8 × 8 | 66.66 | 2.06 | 3.2% |
| 16 × 16 | 126.61 | 1.09 | 1.7% |
| 32 × 32 | 246.97 | 0.56 | 0.9% |

Kernel 1 is 31 to 114 times slower than cuBLAS. The reason is the way its warps read memory, which depends on which threads of a block share a warp. The hardware numbers each thread of a block `x + y × blockDim.x`, so `x` changes fastest, and each run of 32 numbers in a row, e.g., 0 to 31, is one warp. In a block of 8 by 8 threads, a warp is 4 rows of 8 threads, and in a block of 16 by 16 threads, it is 2 rows of 16 threads. In a block of 32 by 32 threads, a warp is one row of 32 threads.

[![The threads of a 16 by 16 block, where each warp is 2 rows, and of a 32 by 32 block, where each warp is 1 row]({{ '/assets/images/cuda-warps.svg' | relative_url }}){: .ia-gpu-overview}]({{ '/assets/images/cuda-warps.svg' | relative_url }})

The threads of a warp read memory together. The memory system moves data in pieces of 32 bytes, called sectors, so a read of one 4-byte number still moves 32 bytes. When several threads of a warp read numbers in the same sector, the GPU moves that sector only once for all of them.

In a 32 by 32 block, the 32 threads of a warp have `threadIdx.x` from 0 to 31 and the same `threadIdx.y`. Kernel 1 takes the row of `C` from x, so the warp works on 32 rows of `C` in one column. At each step `k` of the loop, the 32 threads read `A[i][k]` from 32 different rows of `A`. A row of `A` holds 4,096 numbers, which is 16 KB, so each of the 32 numbers is in its own sector. The warp moves 32 sectors to use 4 bytes from each of them. All 32 threads read the same `B[k][j]`, which is one more sector, so the warp moves 33 sectors at each step.

[![Kernel 1 at one step k: the warp is 32 rows of one column of C. It reads one number from each of 32 rows of A, and each of those numbers needs its own 32-byte sector, plus one number of B, for 33 sectors in all]({{ '/assets/images/matmul-kernel1.svg' | relative_url }}){: .ia-gpu-overview}]({{ '/assets/images/matmul-kernel1.svg' | relative_url }})

In a 16 by 16 block, a warp works on 16 rows and 2 columns of `C`. It reads `A` from 16 rows, and its two numbers of `B` sit next to each other in one sector, so the warp moves 17 sectors at each step. The 16 by 16 blocks move about half as many sectors as the 32 by 32 blocks, and they took about half the time. In an 8 by 8 block, a warp works on 8 rows and 4 columns of `C`, so it moves 8 sectors of `A` and 1 of `B`, which is 9 in all. The 8 by 8 blocks took about half the time again.{% include components/sidenote.html id="sn-ratio" label="2" text="The times for 32 by 32 and 16 by 16 blocks differ by 247 / 127 = 1.95, and their counts of sectors by 33 / 17 = 1.94. For 16 by 16 and 8 by 8 blocks it is 127 / 66.7 = 1.90 against 17 / 9 = 1.89. The speed of kernel 1 is set almost entirely by the number of sectors that its warps move." %}

## Kernel 2: reading neighboring numbers

Kernel 2 swaps the two indices, so the column `j` comes from x and the row `i` comes from y:

```cpp
int j = threadIdx.x + blockDim.x * blockIdx.x;
int i = threadIdx.y + blockDim.y * blockIdx.y;
```

The grid swaps too, with N / 32 blocks in x and M / 32 blocks in y.

A warp is now one row of `C` and 32 neighboring columns. At each step, all 32 threads read the same `A[i][k]`, which is one sector. They also read `B[k][j]` to `B[k][j + 31]`, which are 32 neighboring numbers that take 128 bytes, or 4 sectors. The warp moves 5 sectors at each step instead of 33. When the threads of a warp read neighboring addresses, so that the GPU serves them with only a few sectors, the reads are called coalesced.

[![Kernel 2 at one step k: the warp is 32 neighboring columns of one row of C. It reads one number of A, which is 1 sector, and 32 neighboring numbers in one row of B, which are 4 sectors, for 5 sectors in all]({{ '/assets/images/matmul-kernel2.svg' | relative_url }}){: .ia-gpu-overview}]({{ '/assets/images/matmul-kernel2.svg' | relative_url }})

Kernel 2 took 19.50 ms, which is 7.05 TFLOPS and 12.7 times faster than kernel 1 with the same blocks, and 3.4 times faster than kernel 1 with 8 by 8 blocks.

Kernel 2 still reaches only 11% of cuBLAS. Each `FFMA` in its loop needs two numbers from memory, which is 2 FLOPs for 8 bytes, or 0.25 FLOPs per byte. The ridge point is 9.7 FLOPs per byte, so kernel 2 does far too little math for each byte that it loads.

## Kernel 3: shared memory

In kernel 2, threads in the same block read the same numbers again and again. For example, all the threads in one row of a block need the same row of `A`, and each of them reads it from global memory on its own. Global memory is the memory in HBM that every thread can reach, with the L2 cache in front of it. In kernel 3, the threads of a block copy a piece of `A` and a piece of `B` into shared memory together, and then each thread reads the numbers it needs from there.

Each block computes one square tile of `C`. The rows of that tile need the same rows of `A`, and its columns need the same columns of `B`, so the block works through a strip of `A` and a strip of `B`. It cuts both strips into tiles of the same size as its tile of `C`, and at each step it does four things:

1. The threads copy the current tile of `A` and the current tile of `B` into shared memory, and each thread copies one number of each.
2. The threads wait until both tiles are complete.
3. Each thread multiplies its row of the `A` tile with its column of the `B` tile, and adds the result to its sum.
4. The block moves to the next tile of each strip, which is to the right in `A` and down in `B`.

[![Kernel 3 at step i = 1: the block computes one tile of C. Tile i of its strip of A is in shared memory as s_A and tile i of its strip of B as s_B. Row ty of s_A and column tx of s_B line up with element (tx, ty) of the C tile. At the next step, the tile of A moves right and the tile of B moves down, and after the last step the C tile holds the sum of all the tile products]({{ '/assets/images/matmul-kernel3.svg' | relative_url }}){: .ia-gpu-overview}]({{ '/assets/images/matmul-kernel3.svg' | relative_url }})

Each element of `C` is a sum over `k`, and each pair of tiles covers one stretch of `k`, so each step adds one part of every sum in the tile. When the block reaches the end of the strips, each thread has added all the parts, and its sum is its element of `C`.

Here is the kernel with 32 by 32 tiles:

```cpp
__global__ void sgemm_3(const float* A, const float* B, float* C, int M, int K, int N) {
    // __shared__ puts an array in shared memory, with one copy for each block
    __shared__ float s_A[32][32];
    __shared__ float s_B[32][32];

    // the element of C that this thread computes
    int tx = threadIdx.x, ty = threadIdx.y;
    int row = blockIdx.y * 32 + ty;
    int col = blockIdx.x * 32 + tx;

    float sum = 0.0f;
    for (int i = 0; i < K / 32; i++) {  // step i: tile i of the block's strips of A and B
        s_A[ty][tx] = A[row * K + i * 32 + tx];
        s_B[ty][tx] = B[(i * 32 + ty) * N + col];

        // each thread waits here until every thread of the block has reached it,
        // so both tiles are complete before any thread reads them
        __syncthreads();

        for (int j = 0; j < 32; j++) {
            sum += s_A[ty][j] * s_B[j][tx];
        }

        // every thread is done with the tiles before the next step overwrites them
        __syncthreads();
    }
    C[row * N + col] = sum;
}
```

Both copies from global memory are coalesced, because the threads of a warp have neighboring `tx` and read neighboring numbers in one row of `A` or `B`.

Kernel 3 took 13.32 ms, which is 10.32 TFLOPS and 1.46 times faster than kernel 2.

### How much of an SM a block uses

Each block has 1,024 threads and keeps two 32 by 32 tiles in shared memory, which take 8 KB. An SM holds at most 2,048 threads, so it runs 2 blocks at a time and uses 16 KB of its 228 KB of shared memory.

The tile can't get bigger while each thread computes one element of `C`, because a block can have at most 1,024 threads, and a 32 by 32 tile already needs all of them.

### Operations and loads

At each step, each thread does 32 `FFMA`s, one for each pair of numbers in its row of `s_A` and its column of `s_B`. Three parts of the GPU each set a highest possible speed for kernel 3:

1. The FP32 cores. If they ran an `FFMA` in every cycle, the kernel would reach the full FP32 speed of 74.45 TFLOPS.
2. Global memory. At each step, each thread loads two numbers from global memory, one for `s_A` and one for `s_B`, which is 8 bytes. It then does 32 `FFMA`s, which is 64 FLOPs, so kernel 3 does 64 / 8 = 8 FLOPs for each byte that it loads, which is 32 times the 0.25 FLOPs per byte of kernel 2. The factor of 32 comes from sharing, because each number in `s_A` is used by the 32 threads in its row of the tile, and each number in `s_B` by the 32 threads in its column. Even if every load went to HBM, the ridge point graph would allow 8 × 7,672 GB per second = 61.4 TFLOPS, and the L2 cache serves many of the loads, so the limit is higher.
3. Shared memory. The counts below are for one warp. One warp load from shared memory gives one number to each of the 32 threads, which is 32 numbers. In the compiled code, a warp runs these instructions at each step:
   - 32 `FFMA`s.
   - 32 loads from `s_B`. Each one gives every thread the next number of its column.
   - 8 loads from `s_A`. Each one gives every thread four numbers of its row at once.

   The 128 FP32 cores of an SM finish 4 warp `FFMA`s per cycle, so the 32 `FFMA`s need 8 cycles. Shared memory has 32 banks that each give out one 4-byte number per cycle, which is 32 numbers per cycle, or one warp load of one number for each thread. On the B200, a load of four numbers for each thread takes 2 cycles, even when all 32 threads read the same four numbers, so the 40 loads need about 32 + 8 × 2 = 48 cycles. While shared memory works through those 48 cycles, the FP32 cores are busy for only 8 of them, so the kernel can reach at most 8 / 48 = 17% of the FP32 speed, or about 12.4 TFLOPS.

<details markdown="1">
<summary>SASS of one step of the loop</summary>

Kernel 3 for the B200 (`-O3 -arch=sm_100`), from `cuobjdump -sass`. It was compiled with the bounds checks, which add the `ISETP` and `@!P` instructions at the top. The two `LDG` loads and two `STS` stores copy the tiles, the two `BAR` instructions are the `__syncthreads()` calls, and between them are the 32 `LDS`, 8 `LDS.128` and 32 `FFMA` instructions.

```
.L_x_1:
ISETP.GE.AND P1, PT, R17, UR13, PT
HFMA2 R24, -RZ, RZ, 0, 0
ISETP.GE.AND P0, PT, R16, UR13, PT
ISETP.GE.OR P1, PT, R18, UR12, P1
ISETP.GE.OR P0, PT, R19, R0, P0
MOV R29, RZ
@!P1 LDC.64 R10, c[0x0][0x380]
@!P0 LDC.64 R8, c[0x0][0x388]
@!P1 IMAD.WIDE.U32 R10, R6, 0x4, R10
@!P1 LDG.E R29, desc[UR8][R10.64]
@!P0 IMAD.WIDE R22, R7, 0x4, R8
@!P0 LDG.E R24, desc[UR8][R22.64]
UIADD3 UR4, UPT, UPT, UR4, 0x1, URZ
UISETP.NE.U32.AND UP0, UPT, UR4, URZ, UPT
IADD3 R16, PT, PT, R16, 0x20, RZ
STS [R4], R29
STS [R2], R24
BAR.SYNC.DEFER_BLOCKING 0x0
LDS R28, [R3]
LDS.128 R12, [R5]
LDS R23, [R3+0x80]
LDS R27, [R3+0x100]
LDS R26, [R3+0x180]
LDS R25, [R3+0x200]
LDS.128 R8, [R5+0x10]
LDS R20, [R3+0x280]
LDS R24, [R3+0x380]
LDS R22, [R3+0x480]
FFMA R12, R12, R28, R21
LDS R21, [R3+0x300]
FFMA R12, R23, R13, R12
LDS R23, [R3+0x400]
FFMA R27, R27, R14, R12
FFMA R27, R26, R15, R27
LDS.128 R12, [R5+0x20]
LDS R26, [R3+0x580]
FFMA R27, R8, R25, R27
LDS R25, [R3+0x500]
FFMA R20, R20, R9, R27
FFMA R21, R21, R10, R20
LDS R20, [R3+0x680]
FFMA R27, R24, R11, R21
LDS R21, [R3+0x600]
LDS.128 R8, [R5+0x30]
FFMA R27, R12, R23, R27
LDS R23, [R3+0x700]
FFMA R22, R22, R13, R27
LDS R24, [R3+0x780]
FFMA R25, R25, R14, R22
LDS R22, [R3+0x880]
FFMA R27, R26, R15, R25
LDS R25, [R3+0x800]
LDS.128 R12, [R5+0x40]
LDS R26, [R3+0x980]
FFMA R27, R8, R21, R27
LDS R21, [R3+0x900]
FFMA R20, R20, R9, R27
FFMA R23, R23, R10, R20
LDS R20, [R3+0xa80]
FFMA R27, R24, R11, R23
LDS R23, [R3+0xa00]
LDS.128 R8, [R5+0x50]
FFMA R27, R12, R25, R27
LDS R25, [R3+0xb00]
FFMA R12, R22, R13, R27
LDS R22, [R3+0xb80]
LDS R24, [R3+0xc80]
FFMA R21, R21, R14, R12
FFMA R27, R26, R15, R21
LDS R21, [R3+0xc00]
LDS.128 R12, [R5+0x60]
FFMA R23, R8, R23, R27
FFMA R20, R20, R9, R23
LDS R23, [R3+0xd00]
FFMA R25, R25, R10, R20
LDS R20, [R3+0xd80]
FFMA R27, R22, R11, R25
LDS R25, [R3+0xe00]
LDS.128 R8, [R5+0x70]
LDS R22, [R3+0xe80]
FFMA R27, R12, R21, R27
LDS R21, [R3+0xf00]
LDS R12, [R3+0xf80]
FFMA R24, R24, R13, R27
FFMA R23, R23, R14, R24
FFMA R15, R20, R15, R23
FFMA R15, R8, R25, R15
FFMA R22, R22, R9, R15
IADD3 R17, PT, PT, R17, 0x20, RZ
IADD3 R6, PT, PT, R6, 0x20, RZ
LEA R7, R0, R7, 0x5
FFMA R21, R21, R10, R22
FFMA R21, R12, R11, R21
BAR.SYNC.DEFER_BLOCKING 0x0
BRA.U UP0, `(.L_x_1)
```

</details>

| Limit | Highest speed |
|---|---|
| FP32 cores | 74.45 TFLOPS |
| Global memory, if every load went to HBM | 61.4 TFLOPS |
| Shared memory loads | about 12.4 TFLOPS |
| Measured | 10.32 TFLOPS |

Shared memory loads set the lowest limit, so the next kernel has to do more `FFMA`s for each number that it loads from shared memory.

## Kernel 4: a column of results for each thread

In kernel 3, each `FFMA` needs one number from `s_A` and one from `s_B`, so the loads from shared memory take longer than the math. In kernel 4, each thread computes a short column of elements of `C` instead of one element. All the elements in that column need the same column of `B`, so at each `k` the thread reads one number of `s_B`, keeps it in a register, and uses it for every element of its column. Only the number of `s_A` changes from one element to the next.

The block still walks along a strip of `A` and a strip of `B`, as in kernel 3. Each thread now computes several elements, so a block covers a bigger tile of `C`. The tiles of `A` and `B` are short along `k`, so the tile of `A` is tall and narrow and the tile of `B` is short and wide. At each step, the block does four things:

1. The threads copy the current tile of `A` and the current tile of `B` into shared memory, and each thread copies one number of each.
2. The threads wait until both tiles are complete.
3. For each `k` in the tiles, each thread reads the number of `s_B` in row `k` and its column. It multiplies that number with each number of `s_A` in column `k` and its rows, and adds each product to the element of its column in the same row.
4. The block moves to the next tile of each strip, which is to the right in `A` and down in `B`.

[![Kernel 4 at one k: s_B is short and wide, s_A is tall and narrow, and the tile of C is square. One thread computes a short column of C. It reads one number of s_B in row k and uses it for every element of its column, with a different number of s_A in column k for each element. The next thread computes the next column]({{ '/assets/images/matmul-kernel4.svg' | relative_url }}){: .ia-gpu-overview}]({{ '/assets/images/matmul-kernel4.svg' | relative_url }})

Neighboring threads compute neighboring columns of `C`, so the threads of a warp read neighboring numbers of `s_B` and write neighboring numbers of `C`. If each thread computed a short row of `C` instead, it could reuse a number of `s_A` in the same way, but the threads of a warp would write numbers of `C` that are several columns apart.

Here is the kernel:

```cpp
#define BM 64          // rows of the C tile
#define BN 64          // columns of the C tile
#define TM 16          // results for each thread: a column of TM elements of C
#define BK (BM / TM)   // how far the tiles move along k at each step: s_A and s_B then
                       // hold one number for each thread of the block, so BK is 4

// launched with dim3 block(BN, BM / TM), which is 64 x 4 threads,
// and dim3 grid(N / BN, M / BM), one block for each tile of C
__global__ void sgemm_4(const float* A, const float* B, float* C, int M, int K, int N) {
    __shared__ float s_A[BM][BK];  // 64 x 4 tile of A
    __shared__ float s_B[BK][BN];  // 4 x 64 tile of B

    int tx = threadIdx.x, ty = threadIdx.y;

    // corner of this block's tile of C
    int block_row = blockIdx.y * BM;
    int block_col = blockIdx.x * BN;

    // this thread computes rows c_row to c_row + TM - 1 of column c_col of the tile
    int c_col = tx;
    int c_row = ty * TM;

    // the number this thread copies into s_A: s_A is 64 x 4, not the block's shape,
    // so number the threads 0 to 255 and count 4 numbers to a row
    int tid = ty * BN + tx;
    int a_row = tid / BK, a_col = tid % BK;

    // the number this thread copies into s_B: s_B has the block's shape
    int b_row = ty, b_col = tx;

    float results[TM] = {0.0f};
    for (int i = 0; i < K / BK; i++) {
        s_A[a_row][a_col] = A[(block_row + a_row) * K + i * BK + a_col];
        s_B[b_row][b_col] = B[(i * BK + b_row) * N + block_col + b_col];
        __syncthreads();
        for (int k = 0; k < BK; k++) {
            float b = s_B[k][c_col];  // read once, used for all TM results
            for (int r = 0; r < TM; r++) {
                results[r] += s_A[c_row + r][k] * b;
            }
        }
        __syncthreads();
    }
    for (int r = 0; r < TM; r++) {
        C[(block_row + c_row + r) * N + block_col + c_col] = results[r];
    }
}
```

A warp is 32 threads with neighboring `tx` and the same `ty`, so it covers 32 neighboring columns of the tile and the same 16 rows. Its copy into `s_B` reads 32 neighboring numbers in one row of `B`, which is coalesced. Its copy into `s_A` reads 8 rows of `A` with 4 neighboring numbers in each, so it needs one sector for each row and uses half of each sector.

Kernel 4 took 6.35 ms, which is 21.65 TFLOPS and 2.10 times faster than kernel 3. I also tried columns of 4, 8 and 32 results, each with BK = 64 / TM, and they took 9.86, 7.72 and 7.48 ms.

### How much of an SM a block uses

- Threads: a block has 64 by 4 = 256 threads, and each one computes a column of 16 elements, so the tile of `C` is 64 by 64.
- Shared memory: `s_A` and `s_B` take 2 KB, far below what an SM has.
- Registers: each thread keeps its 16 results and its other variables in registers, and the threads of an SM share 65,536 of them.
  - Kernel 4 uses 60 registers for each thread, so a block of 256 threads needs 256 × 60 = 15,360 registers.
  - 4 blocks need 61,440, and a fifth block doesn't fit, so an SM runs 1,024 threads, half of the 2,048 that it can hold.

### Operations and loads

At each step, which covers 4 values of `k`, one warp:

- Does 64 `FFMA`s, which keep the FP32 cores busy for 16 cycles.
- Loads 20 times from shared memory, which takes 36 cycles.
  - 4 loads from `s_B`, one for each `k`, which take 1 cycle each.
  - 16 loads from `s_A`, one for each row of results. Each one reads the 4 neighboring numbers of one row of `s_A` and takes 2 cycles. All 32 threads of a warp compute the same rows, so each of these loads gives the same 4 numbers to every thread.

[![Busy time of one warp for 64 FFMAs. The FP32 cores need 16 cycles. Shared memory needs 96 cycles in kernel 3 and 36 cycles in kernel 4, so it still takes longer than the FP32 cores in both]({{ '/assets/images/kernel4-busy.svg' | relative_url }}){: .ia-gpu-overview}]({{ '/assets/images/kernel4-busy.svg' | relative_url }})

Shared memory still takes longer than the FP32 cores, so it still sets the limit, but by much less than in kernel 3. Global memory doesn't set the limit, because each number that a block copies into shared memory is now used for 64 elements of `C` instead of 32. Kernel 4 does twice as many FLOPs for each byte as kernel 3, which puts it above the ridge point.

<details markdown="1">
<summary>SASS of one step of the loop</summary>

Kernel 4 for the B200 (`-O3 -arch=sm_100`), from `cuobjdump -sass`. It was compiled with the bounds checks, which add the `ISETP` and `@!P` instructions. The compiler handles two steps in each pass, so the listing shows two steps: 4 `LDG` loads and 4 `STS` stores copy the tiles, the 4 `BAR` instructions are the `__syncthreads()` calls, and between them are 8 `LDS`, 32 `LDS.128` and 128 `FFMA` instructions. `.L_x_2` is the code after the loop. The `.reuse` flag on an `FFMA` tells the GPU to keep that number close to the cores for the next `FFMA`, so the next one doesn't read it from the registers again.

```
LDC R12, c[0x0][0x3a0]
LDCU UR4, c[0x0][0x398]
LEA R4, R3, R0.reuse, 0x6
CS2R R10, SRZ
LOP3.LUT R45, R0, 0x3, RZ, 0xc0, !PT
SHF.R.U32.HI R9, RZ, 0x2, R4
LEA R43, R41, R0, 0x6
ISETP.GE.AND P0, PT, R45, UR7, PT
LEA R46, R2, R9, 0x6
IMAD R48, R46.reuse, UR7, R45
ISETP.GE.OR P0, PT, R46, UR4, P0
ISETP.GE.AND P1, PT, R43, R12.reuse, PT
IMAD R8, R3, R12, R0
ISETP.GE.OR P1, PT, R3, UR7, P1
LEA R13, R41, R8, 0x6
@!P0 LDC.64 R4, c[0x0][0x380]
@!P1 LDC.64 R6, c[0x0][0x388]
@!P0 IMAD.WIDE.U32 R4, R48, 0x4, R4
@!P0 LDG.E R10, desc[UR8][R4.64]
@!P1 IMAD.WIDE R6, R13, 0x4, R6
@!P1 LDG.E R11, desc[UR8][R6.64]
S2UR UR6, SR_CgaCtaId
UMOV UR4, 0x400
UIADD3 UR5, UPT, UPT, UR4, 0x400, URZ
ULEA UR4, UR6, UR4, 0x18
ULEA UR5, UR6, UR5, 0x18
LEA R8, R9, UR4, 0x4
LEA R9, R3, UR5, 0x8
LEA R45, R45, R8, 0x2
LEA R44, R0.reuse, R9, 0x2
LEA R42, R0, UR5, 0x2
LEA R40, R3, UR4, 0x8
UIADD3 UR4, UPT, UPT, UR7, 0x3, URZ
USHF.R.U32.HI UR4, URZ, 0x2, UR4
UIADD3 UR4, UPT, UPT, -UR4, 0x1, URZ
UISETP.NE.U32.AND UP0, UPT, UR4, URZ, UPT
STS [R45], R10
STS [R44], R11
BAR.SYNC.DEFER_BLOCKING 0x0
LDS R57, [R42]
LDS.128 R36, [R40]
LDS.128 R16, [R40+0x10]
LDS R50, [R42+0x100]
LDS.128 R20, [R40+0x20]
LDS R55, [R42+0x200]
LDS R52, [R42+0x300]
LDS.128 R24, [R40+0x30]
LDS.128 R4, [R40+0x50]
LDS.128 R28, [R40+0x40]
LDS.128 R32, [R40+0x70]
FFMA R9, R57.reuse, R36, RZ
FFMA R16, R57, R16, RZ
FFMA R14, R50.reuse, R37, R9
FFMA R17, R50, R17, R16
LDS.128 R8, [R40+0x60]
FFMA R20, R57, R20, RZ
LEA R36, R12, R13, 0x2
FFMA R21, R50, R21, R20
FFMA R37, R55.reuse, R38, R14
FFMA R18, R55.reuse, R18, R17
LDS.128 R12, [R40+0x80]
FFMA R22, R55, R22, R21
FFMA R39, R52.reuse, R39, R37
FFMA R37, R52.reuse, R19, R18
FFMA R21, R57, R24, RZ
LDS.128 R16, [R40+0x90]
FFMA R47, R52, R23, R22
FFMA R24, R50, R25, R21
LDS.128 R20, [R40+0xa0]
FFMA R4, R57, R4, RZ
FFMA R4, R50, R5, R4
FFMA R25, R57, R28, RZ
FFMA R51, R55, R6, R4
FFMA R25, R50, R29, R25
FFMA R5, R57, R8, RZ
FFMA R4, R50, R9, R5
FFMA R5, R57, R32, RZ
FFMA R29, R55, R10, R4
FFMA R12, R57, R12, RZ
FFMA R8, R50, R33, R5
FFMA R49, R55, R26, R24
FFMA R33, R52, R11, R29
FFMA R13, R50, R13, R12
FFMA R9, R57, R16, RZ
FFMA R11, R55.reuse, R34, R8
FFMA R30, R55, R30, R25
FFMA R51, R52, R7, R51
FFMA R8, R50, R17, R9
FFMA R9, R57, R20, RZ
LDS.128 R4, [R40+0xc0]
FFMA R14, R55, R14, R13
FFMA R49, R52, R27, R49
LDS.128 R24, [R40+0xb0]
FFMA R53, R52.reuse, R31, R30
FFMA R35, R52, R35, R11
FFMA R17, R55.reuse, R18, R8
FFMA R16, R50, R21, R9
FFMA R32, R52, R15, R14
LDS.128 R28, [R40+0xd0]
LDS.128 R8, [R40+0xe0]
LDS.128 R12, [R40+0xf0]
FFMA R22, R55, R22, R16
FFMA R4, R57.reuse, R4, RZ
FFMA R21, R57, R24, RZ
FFMA R4, R50.reuse, R5, R4
FFMA R21, R50, R25, R21
FFMA R5, R57.reuse, R28, RZ
FFMA R25, R52, R19, R17
FFMA R8, R57, R8, RZ
FFMA R17, R55, R6, R4
FFMA R12, R57, R12, RZ
FFMA R4, R50.reuse, R29, R5
FFMA R9, R50.reuse, R9, R8
FFMA R13, R50, R13, R12
FFMA R26, R55.reuse, R26, R21
FFMA R4, R55.reuse, R30, R4
FFMA R10, R55.reuse, R10, R9
FFMA R14, R55, R14, R13
FFMA R27, R52.reuse, R27, R26
FFMA R24, R52.reuse, R23, R22
FFMA R29, R52.reuse, R7, R17
FFMA R31, R52.reuse, R31, R4
FFMA R26, R52.reuse, R11, R10
FFMA R52, R52, R15, R14
BAR.SYNC.DEFER_BLOCKING 0x0
BRA.U !UP0, `(.L_x_2)
LOP3.LUT R30, R0, 0x3, RZ, 0xc0, !PT
LDCU.64 UR6, c[0x0][0x398]
MOV R38, R36
IADD3 R34, PT, PT, R48, 0x4, RZ
IADD3 R36, PT, PT, R3, 0x4, RZ
IADD3 R30, PT, PT, R30, 0x4, RZ
.L_x_1:
LDC R28, c[0x0][0x3a0]
ISETP.GE.AND P0, PT, R30, UR7, PT
CS2R R54, SRZ
ISETP.GE.OR P1, PT, R46, UR6, P0
@!P1 LDC.64 R6, c[0x0][0x380]
ISETP.GE.AND P2, PT, R43, R28, PT
ISETP.GE.OR P0, PT, R36, UR7, P2
@!P0 LDC.64 R4, c[0x0][0x388]
@!P1 IMAD.WIDE.U32 R6, R34, 0x4, R6
@!P1 LDG.E R54, desc[UR8][R6.64]
@!P0 IMAD.WIDE R4, R38, 0x4, R4
@!P0 LDG.E R55, desc[UR8][R4.64]
UIADD3 UR4, UPT, UPT, UR4, 0x1, URZ
UISETP.NE.U32.AND UP0, UPT, UR4, URZ, UPT
LEA R38, R28, R38, 0x2
IADD3 R30, PT, PT, R30, 0x4, RZ
IADD3 R36, PT, PT, R36, 0x4, RZ
IADD3 R34, PT, PT, R34, 0x4, RZ
STS [R45], R54
STS [R44], R55
BAR.SYNC.DEFER_BLOCKING 0x0
LDS R50, [R42]
LDS.128 R12, [R40+0x10]
LDS R48, [R42+0x100]
LDS R54, [R42+0x200]
LDS R56, [R42+0x300]
LDS.128 R20, [R40+0x30]
LDS.128 R8, [R40]
LDS.128 R16, [R40+0x20]
LDS.128 R4, [R40+0x40]
FFMA R37, R50, R12, R37
FFMA R13, R48, R13, R37
FFMA R14, R54, R14, R13
FFMA R37, R56, R15, R14
LDS.128 R12, [R40+0x50]
FFMA R20, R50, R20, R49
FFMA R21, R48, R21, R20
FFMA R39, R50, R8, R39
FFMA R22, R54, R22, R21
FFMA R16, R50.reuse, R16, R47
FFMA R53, R50, R4, R53
FFMA R9, R48.reuse, R9, R39
FFMA R17, R48, R17, R16
FFMA R49, R56, R23, R22
FFMA R5, R48, R5, R53
LDS.128 R20, [R40+0x70]
FFMA R9, R54.reuse, R10, R9
FFMA R18, R54.reuse, R18, R17
FFMA R5, R54, R6, R5
FFMA R39, R56.reuse, R11, R9
FFMA R47, R56.reuse, R19, R18
FFMA R53, R56, R7, R5
LDS.128 R16, [R40+0x60]
LDS.128 R8, [R40+0x80]
LDS.128 R4, [R40+0x90]
FFMA R51, R50, R12, R51
FFMA R13, R48, R13, R51
FFMA R14, R54, R14, R13
FFMA R51, R56, R15, R14
LDS.128 R12, [R40+0xa0]
FFMA R20, R50, R20, R35
FFMA R21, R48, R21, R20
FFMA R22, R54, R22, R21
FFMA R16, R50.reuse, R16, R33
FFMA R21, R50.reuse, R8, R32
FFMA R25, R50, R4, R25
FFMA R17, R48.reuse, R17, R16
FFMA R9, R48.reuse, R9, R21
FFMA R5, R48, R5, R25
FFMA R18, R54.reuse, R18, R17
FFMA R9, R54.reuse, R10, R9
FFMA R6, R54, R6, R5
FFMA R12, R50, R12, R24
FFMA R13, R48, R13, R12
FFMA R14, R54, R14, R13
FFMA R33, R56.reuse, R19, R18
FFMA R35, R56.reuse, R23, R22
FFMA R32, R56.reuse, R11, R9
FFMA R25, R56.reuse, R7, R6
FFMA R24, R56, R15, R14
LDS.128 R16, [R40+0xb0]
LDS.128 R20, [R40+0xc0]
LDS.128 R4, [R40+0xd0]
LDS.128 R8, [R40+0xe0]
LDS.128 R12, [R40+0xf0]
FFMA R16, R50.reuse, R16, R27
FFMA R29, R50.reuse, R20, R29
FFMA R31, R50.reuse, R4, R31
FFMA R8, R50.reuse, R8, R26
FFMA R12, R50, R12, R52
FFMA R17, R48.reuse, R17, R16
FFMA R21, R48.reuse, R21, R29
FFMA R5, R48.reuse, R5, R31
FFMA R9, R48.reuse, R9, R8
FFMA R13, R48, R13, R12
FFMA R18, R54.reuse, R18, R17
FFMA R21, R54.reuse, R22, R21
FFMA R5, R54.reuse, R6, R5
FFMA R10, R54.reuse, R10, R9
FFMA R14, R54, R14, R13
FFMA R27, R56.reuse, R19, R18
FFMA R29, R56.reuse, R23, R21
FFMA R31, R56.reuse, R7, R5
FFMA R26, R56.reuse, R11, R10
FFMA R52, R56, R15, R14
BAR.SYNC.DEFER_BLOCKING 0x0
BRA.U UP0, `(.L_x_1)
```

</details>

Nsight Compute, NVIDIA's profiler, measures where the time of a kernel goes. For kernel 4 it shows:

- Shared memory works for 36 cycles at each step of a warp, which is where the 2 cycles for each load of 4 numbers come from.
- The shared memory pipe is busy 87% of the time and the FP32 cores 31%, so shared memory is the busiest part.
- The most common reasons why a warp can't run its next instruction are waiting for its numbers from global memory, waiting for its numbers from shared memory, and waiting at `__syncthreads()`.

Each thread uses a number of `s_B` for all of its results, but it uses each number of `s_A` for only one result. A thread could compute a square of results instead of a column, so that it reuses the numbers of `s_A` as well, which is called 2D tiling. 2D tiling cuts the loads from shared memory, which set the limit in kernel 4.

## Kernel 5: a square of results for each thread

In kernel 5, each thread computes a small square of elements of `C`, a few rows by a few columns. At each `k`, the thread reads the numbers of `s_A` in its rows and the numbers of `s_B` in its columns into registers. It then multiplies every number of `s_A` with every number of `s_B`, so each number of `s_A` is used for a whole row of its square, and each number of `s_B` for a whole column.

The steps along the strips are the same as in kernel 4, and only the math at each `k` changes.

[![Kernel 5 at one k: one thread computes a small square of C. It reads the numbers of s_A in column k and its rows, and the numbers of s_B in row k and its columns, multiplies every pair and adds each product to the element of its square in the same row and column. The next thread computes the next square]({{ '/assets/images/matmul-kernel5.svg' | relative_url }}){: .ia-gpu-overview}]({{ '/assets/images/matmul-kernel5.svg' | relative_url }})

Here is the kernel:

```cpp
#define BM 64                // rows of the C tile
#define BN 64                // columns of the C tile; the tile must be square, see BK
#define TM 4                 // rows of the square that each thread computes
#define TN 4                 // columns of the square
#define BK (BM / (TM * TN))  // how far the tiles move along k at each step: s_A and s_B then
                             // hold one number for each thread of the block, so BK is 4
#define NT ((BM / TM) * (BN / TN))  // threads per block: 16 x 16 = 256

// launched with dim3 block(BN / TN, BM / TM), which is 16 x 16 threads,
// and dim3 grid(N / BN, M / BM), one block for each tile of C
__global__ void sgemm_5(const float* A, const float* B, float* C, int M, int K, int N) {
    __shared__ float s_A[BM][BK];  // 64 x 4 tile of A
    __shared__ float s_B[BK][BN];  // 4 x 64 tile of B

    int tx = threadIdx.x, ty = threadIdx.y;

    // corner of this block's tile of C
    int block_row = blockIdx.y * BM;
    int block_col = blockIdx.x * BN;

    // this thread computes a TM x TN square of the tile, starting at row c_row and column c_col
    int c_row = ty * TM;
    int c_col = tx * TN;

    // the number this thread copies into s_A and into s_B: number the threads 0 to 255,
    // so that neighboring threads copy neighboring numbers
    int tid = ty * (BN / TN) + tx;
    int a_row = tid / BK, a_col = tid % BK;
    int b_row = tid / BN, b_col = tid % BN;

    float results[TM][TN] = {0.0f};
    float reg_A[TM];  // column k of s_A, in this thread's rows
    float reg_B[TN];  // row k of s_B, in this thread's columns

    for (int i = 0; i < K / BK; i++) {
        s_A[a_row][a_col] = A[(block_row + a_row) * K + i * BK + a_col];
        s_B[b_row][b_col] = B[(i * BK + b_row) * N + block_col + b_col];
        __syncthreads();

        for (int k = 0; k < BK; k++) {
            for (int m = 0; m < TM; m++) reg_A[m] = s_A[c_row + m][k];
            for (int n = 0; n < TN; n++) reg_B[n] = s_B[k][c_col + n];
            // every number of reg_A with every number of reg_B
            for (int m = 0; m < TM; m++) {
                for (int n = 0; n < TN; n++) {
                    results[m][n] += reg_A[m] * reg_B[n];
                }
            }
        }
        __syncthreads();
    }
    for (int m = 0; m < TM; m++) {
        for (int n = 0; n < TN; n++) {
            C[(block_row + c_row + m) * N + block_col + c_col + n] = results[m][n];
        }
    }
}
```

Kernel 5 took 5.53 ms, which is 24.86 TFLOPS and 1.15 times faster than kernel 4. With one copy for each thread, the tile has to be square and BK = BM / (TM × TN), which leaves only a few sizes. I tried 8 of them, and 64 by 64 with 4 by 4 squares ran fastest. A 128 by 128 tile with 8 by 4 squares, for example, took 7.54 ms, because its 80 registers for each thread let only one block of 512 threads fit on an SM.

### How much of an SM a block uses

- Threads: a block has 16 by 16 = 256 threads, and each one computes a 4 by 4 square, so the tile of `C` is 64 by 64, as in kernel 4.
- Shared memory: `s_A` and `s_B` hold 256 numbers each, which is 2 KB in all, one number of each for every thread.
- Registers: kernel 5 uses 56 registers for each thread, so a block needs 256 × 56 = 14,336 registers, and 4 blocks fit on an SM, which is 1,024 threads.

### Operations and loads

At each `k`, each thread does 16 `FFMA`s, and it needs 4 numbers of `s_A` and 4 numbers of `s_B`:

- The 4 numbers of `s_B` sit next to each other in one row, so one `LDS.128` reads them.
- The 4 numbers of `s_A` are in 4 different rows, but each row of `s_A` holds its 4 numbers for the 4 values of `k` in the step next to each other. One `LDS.128` reads a row's numbers for all 4 values of `k` at once, so the 4 rows need 1 load for each `k`.
- In all, a thread does 16 `FFMA`s for 2 loads, or 8 `FFMA`s for each load, against about 3 in kernel 4.
- Nsight Compute measures 3 cycles of shared memory for each of these loads on average, so 64 `FFMA`s need 24 cycles of shared memory and 16 cycles of the FP32 cores.
- The tile of `C` has the same size as in kernel 4, so global memory does the same number of FLOPs for each byte, which is above the ridge point.

[![Busy time of one warp for 64 FFMAs. The FP32 cores need 16 cycles in each kernel. Shared memory needs 96 cycles in kernel 3, 36 in kernel 4 and 24 in kernel 5, so it still takes longer than the FP32 cores in all three]({{ '/assets/images/kernel5-busy.svg' | relative_url }}){: .ia-gpu-overview}]({{ '/assets/images/kernel5-busy.svg' | relative_url }})

<details markdown="1">
<summary>SASS of one step of the loop</summary>

Kernel 5 for the B200 (`-O3 -arch=sm_100`), from `cuobjdump -sass`, compiled with the bounds checks. The compiler handles two steps in each pass, so the listing shows two steps: 4 `LDG` loads and 4 `STS` stores copy the tiles, the 4 `BAR` instructions are the `__syncthreads()` calls, and between them 16 `LDS.128` loads feed 128 `FFMA`s. `.L_x_2` is the code after the loop.

```
LDC R42, c[0x0][0x3a0]
LDCU UR5, c[0x0][0x398]
LEA R8, R2, R0, 0x4
LOP3.LUT R40, R0, 0x3, RZ, 0xc0, !PT
LOP3.LUT R41, R8, 0x3f, RZ, 0xc0, !PT
SHF.R.U32.HI R10, RZ, 0x2, R8
IADD3 R23, PT, PT, R41, UR4, RZ
ISETP.GE.AND P0, PT, R40, UR8, PT
LEA R37, R3, R10, 0x6
SHF.R.U32.HI R38, RZ, 0x6, R8
MOV R29, RZ
IMAD R39, R37.reuse, UR8, R40
ISETP.GE.OR P0, PT, R37, UR5, P0
MOV R31, RZ
ISETP.GE.AND P1, PT, R23, R42.reuse, PT
IMAD R12, R38, R42, UR4
ISETP.GE.OR P1, PT, R38, UR8, P1
IADD3 R41, PT, PT, R41, R12, RZ
@!P0 LDC.64 R4, c[0x0][0x380]
@!P1 LDC.64 R6, c[0x0][0x388]
@!P0 IMAD.WIDE.U32 R4, R39, 0x4, R4
@!P0 LDG.E R29, desc[UR10][R4.64]
@!P1 IMAD.WIDE R6, R41, 0x4, R6
@!P1 LDG.E R31, desc[UR10][R6.64]
S2UR UR7, SR_CgaCtaId
UMOV UR5, 0x400
UIADD3 UR6, UPT, UPT, UR5, 0x400, URZ
SHF.L.U32 R8, R8, 0x2, RZ
LOP3.LUT R11, R8, 0xfc, RZ, 0xc0, !PT
ULEA UR5, UR7, UR5, 0x18
ULEA UR6, UR7, UR6, 0x18
LEA R9, R10, UR5, 0x4
LEA R22, R38, UR6, 0x8
LEA R36, R40, R9, 0x2
IADD3 R22, PT, PT, R22, R11, RZ
LEA R20, R2, UR5, 0x6
LEA R21, R0, UR6, 0x4
UIADD3 UR5, UPT, UPT, UR8, 0x3, URZ
USHF.R.U32.HI UR5, URZ, 0x2, UR5
UIADD3 UR5, UPT, UPT, -UR5, 0x1, URZ
LEA R41, R42, R41, 0x2
UISETP.NE.U32.AND UP0, UPT, UR5, URZ, UPT
STS [R36], R29
STS [R22], R31
BAR.SYNC.DEFER_BLOCKING 0x0
LDS.128 R12, [R20]
LDS.128 R32, [R21]
LDS.128 R8, [R20+0x10]
LDS.128 R24, [R21+0x100]
LDS.128 R4, [R20+0x20]
LDS.128 R16, [R20+0x30]
FFMA R47, R12.reuse, R32, RZ
FFMA R28, R12.reuse, R33, RZ
FFMA R43, R12.reuse, R34, RZ
FFMA R12, R12, R35, RZ
FFMA R44, R8.reuse, R33, RZ
FFMA R51, R8, R32, RZ
FFMA R47, R24, R13, R47
FFMA R45, R13.reuse, R25, R28
FFMA R43, R13.reuse, R26, R43
FFMA R12, R13, R27, R12
FFMA R13, R8.reuse, R34, RZ
FFMA R8, R8, R35, RZ
FFMA R49, R9.reuse, R25, R44
FFMA R44, R4.reuse, R33, RZ
FFMA R53, R4.reuse, R32, RZ
FFMA R46, R4.reuse, R34, RZ
FFMA R48, R4, R35, RZ
LDS.128 R28, [R21+0x200]
FFMA R51, R24.reuse, R9, R51
FFMA R13, R9.reuse, R26.reuse, R13
FFMA R8, R9, R27, R8
FFMA R9, R5.reuse, R25, R44
FFMA R53, R24, R5, R53
FFMA R4, R5.reuse, R26, R46
FFMA R44, R5, R27, R48
FFMA R5, R16.reuse, R32, RZ
FFMA R48, R16.reuse, R33, RZ
FFMA R46, R16.reuse, R34, RZ
FFMA R16, R16, R35, RZ
LDS.128 R32, [R21+0x300]
FFMA R5, R24, R17, R5
FFMA R25, R17.reuse, R25, R48
FFMA R26, R17.reuse, R26, R46
FFMA R16, R17, R27, R16
FFMA R47, R28, R14, R47
FFMA R42, R14.reuse, R29.reuse, R45
FFMA R43, R14, R30, R43
FFMA R46, R6, R29, R9
FFMA R14, R14, R31, R12
FFMA R53, R28, R6, R53
FFMA R9, R6, R30, R4
FFMA R51, R28, R10, R51
FFMA R12, R10.reuse, R29, R49
FFMA R13, R10.reuse, R30, R13
FFMA R8, R10, R31.reuse, R8
FFMA R6, R6, R31, R44
FFMA R5, R28, R18, R5
FFMA R4, R18.reuse, R29, R25
FFMA R17, R18.reuse, R30, R26
FFMA R16, R18, R31, R16
FFMA R24, R32.reuse, R15, R47
FFMA R26, R15.reuse, R34.reuse, R43
FFMA R25, R15.reuse, R33, R42
FFMA R27, R15, R35, R14
FFMA R43, R32.reuse, R11, R51
FFMA R44, R11.reuse, R33, R12
FFMA R45, R11.reuse, R34.reuse, R13
FFMA R49, R11, R35, R8
FFMA R48, R32.reuse, R7, R53
FFMA R46, R7.reuse, R33, R46
FFMA R47, R7.reuse, R34.reuse, R9
FFMA R50, R7, R35, R6
FFMA R32, R32, R19, R5
FFMA R33, R19.reuse, R33, R4
FFMA R34, R19.reuse, R34, R17
FFMA R35, R19, R35, R16
BAR.SYNC.DEFER_BLOCKING 0x0
BRA.U !UP0, `(.L_x_2)
IADD3 R38, PT, PT, R38, 0x4, RZ
LDCU.64 UR6, c[0x0][0x398]
IADD3 R39, PT, PT, R39, 0x4, RZ
IADD3 R40, PT, PT, R40, 0x4, RZ
.L_x_1:
LDC R42, c[0x0][0x3a0]
ISETP.GE.AND P0, PT, R40, UR7, PT
HFMA2 R9, -RZ, RZ, 0, 0
MOV R11, RZ
ISETP.GE.OR P1, PT, R37, UR6, P0
@!P1 LDC.64 R6, c[0x0][0x380]
ISETP.GE.AND P2, PT, R23, R42, PT
ISETP.GE.OR P0, PT, R38, UR7, P2
@!P0 LDC.64 R4, c[0x0][0x388]
@!P1 IMAD.WIDE.U32 R6, R39, 0x4, R6
@!P1 LDG.E R9, desc[UR10][R6.64]
@!P0 IMAD.WIDE R52, R41, 0x4, R4
@!P0 LDG.E R11, desc[UR10][R52.64]
UIADD3 UR5, UPT, UPT, UR5, 0x1, URZ
UISETP.NE.U32.AND UP0, UPT, UR5, URZ, UPT
LEA R41, R42, R41, 0x2
IADD3 R40, PT, PT, R40, 0x4, RZ
IADD3 R38, PT, PT, R38, 0x4, RZ
IADD3 R39, PT, PT, R39, 0x4, RZ
STS [R36], R9
STS [R22], R11
BAR.SYNC.DEFER_BLOCKING 0x0
LDS.128 R4, [R20]
LDS.128 R28, [R21]
LDS.128 R8, [R20+0x10]
LDS.128 R12, [R20+0x20]
LDS.128 R16, [R20+0x30]
FFMA R51, R4.reuse, R28, R24
FFMA R52, R4.reuse, R29, R25
FFMA R53, R4.reuse, R30, R26
FFMA R4, R4, R31, R27
LDS.128 R24, [R21+0x100]
FFMA R43, R8.reuse, R28, R43
FFMA R44, R8.reuse, R29, R44
FFMA R45, R8.reuse, R30, R45
FFMA R8, R8, R31, R49
FFMA R48, R12.reuse, R28, R48
FFMA R46, R12.reuse, R29, R46
FFMA R47, R12.reuse, R30, R47
FFMA R50, R12, R31, R50
FFMA R32, R16.reuse, R28, R32
FFMA R12, R16.reuse, R29, R33
FFMA R49, R16.reuse, R30, R34
FFMA R16, R16, R31, R35
LDS.128 R28, [R21+0x200]
FFMA R51, R24.reuse, R5, R51
FFMA R52, R5.reuse, R25, R52
FFMA R53, R5.reuse, R26.reuse, R53
FFMA R4, R5, R27, R4
FFMA R43, R24.reuse, R9, R43
FFMA R5, R9.reuse, R25, R44
FFMA R45, R9.reuse, R26.reuse, R45
FFMA R8, R9, R27, R8
FFMA R9, R24.reuse, R13, R48
FFMA R46, R13.reuse, R25, R46
FFMA R47, R13.reuse, R26, R47
FFMA R50, R13, R27, R50
FFMA R13, R24, R17, R32
LDS.128 R32, [R21+0x300]
FFMA R25, R17.reuse, R25, R12
FFMA R49, R17.reuse, R26, R49
FFMA R16, R17, R27, R16
FFMA R51, R28, R6, R51
FFMA R52, R6.reuse, R29, R52
FFMA R53, R6.reuse, R30, R53
FFMA R4, R6, R31, R4
FFMA R43, R28, R10, R43
FFMA R44, R10.reuse, R29, R5
FFMA R45, R10.reuse, R30, R45
FFMA R8, R10, R31, R8
FFMA R9, R28, R14, R9
FFMA R46, R14.reuse, R29, R46
FFMA R47, R14.reuse, R30, R47
FFMA R50, R14, R31, R50
FFMA R13, R28, R18, R13
FFMA R6, R18.reuse, R29, R25
FFMA R5, R18.reuse, R30, R49
FFMA R16, R18, R31, R16
FFMA R24, R32.reuse, R7, R51
FFMA R25, R7.reuse, R33, R52
FFMA R26, R7.reuse, R34.reuse, R53
FFMA R27, R7, R35, R4
FFMA R43, R32.reuse, R11, R43
FFMA R44, R11.reuse, R33, R44
FFMA R45, R11.reuse, R34.reuse, R45
FFMA R49, R11, R35, R8
FFMA R48, R32.reuse, R15, R9
FFMA R46, R15.reuse, R33, R46
FFMA R47, R15.reuse, R34.reuse, R47
FFMA R50, R15, R35, R50
FFMA R32, R32, R19, R13
FFMA R33, R19.reuse, R33, R6
FFMA R34, R19.reuse, R34, R5
FFMA R35, R19, R35, R16
BAR.SYNC.DEFER_BLOCKING 0x0
BRA.U UP0, `(.L_x_1)
```

</details>

Shared memory still takes longer than the FP32 cores, but the gap is smaller than in kernel 4. Nsight Compute shows the pipe that runs the `FFMA`s busy 37% of the time and shared memory 74%. The most common reasons why a warp waits are its numbers from global memory, its numbers from shared memory and `__syncthreads()`, in that order. With BK = 4, a warp does only 64 `FFMA`s at each step between two of these waits.

## Kernel 6: vectorized loads

In kernel 5, each thread copies one number of `A` and one of `B` at each step. A block has 256 threads, so a tile of `A` holds 256 numbers, which is 64 rows by 4 columns, and each step covers only 4 values of `k`. A warp waits for global memory and at `__syncthreads()` once in every step, so with such short steps it spends much of its time waiting.

In kernel 6, each thread copies 4 neighboring numbers of a row at once:

- One vector load reads the 4 numbers from global memory, and one vector store writes them into shared memory. CUDA does both with `float4`, a type that holds four floats, so each one is a single 16-byte instruction.
- A copy now holds 4 numbers, so a step can cover more values of `k`. When a tile holds more groups of 4 than the block has threads, each thread copies several groups, one after another.
- Neighboring threads still copy neighboring numbers, so a warp's reads stay coalesced, as they were in kernel 5. Only the amount that each thread reads with one instruction grows.
- The loop that computes the results is the same as in kernel 5.

[![How the threads of a block copy a tile of A. In kernel 5, a row of the tile takes 4 threads that copy one number each, so a step covers 4 values of k. In kernel 6, each thread copies 4 neighboring numbers with one float4 load, and a second group of 4 in the same columns 64 rows further down, so a step covers 32 values of k]({{ '/assets/images/kernel6-copy.svg' | relative_url }}){: .ia-gpu-overview}]({{ '/assets/images/kernel6-copy.svg' | relative_url }})

Because a thread can copy several groups, the tile doesn't have to be square, and BK doesn't depend on the number of threads. I tried 52 sizes, with tiles of 64, 128 or 256 rows and columns, squares of 4 or 8 rows and columns, and BK of 8, 16 or 32. A 128 by 128 tile with 8 by 4 squares and BK = 32 ran fastest. Here are the parts of the kernel that change:

```cpp
// __align__(16): each group of 4 starts on a 16-byte boundary, which a float4 store needs
__shared__ __align__(16) float s_A[BM][BK];
__shared__ __align__(16) float s_B[BK][BN];

// the first group of 4 neighboring numbers that this thread copies in each tile.
// its other groups sit in the same columns, a_stride or b_stride rows further down
int a_row = tid / (BK / 4), a_col = (tid % (BK / 4)) * 4;  // a row of s_A has 8 groups of 4
int b_row = tid / (BN / 4), b_col = (tid % (BN / 4)) * 4;  // a row of s_B has 32 groups of 4
int a_stride = NT / (BK / 4), b_stride = NT / (BN / 4);     // 64 and 16 rows

for (int i = 0; i < K / BK; i++) {
    // reinterpret_cast reads the address of the first number as the address of a float4,
    // so each copy is one 16-byte load from global memory and one 16-byte store to shared memory.
    // A_COPIES = BM * BK / (4 * NT) = 2, and B_COPIES = BK * BN / (4 * NT) = 2
    for (int c = 0; c < A_COPIES; c++) {
        int r = a_row + c * a_stride;
        *reinterpret_cast<float4*>(&s_A[r][a_col]) =
            *reinterpret_cast<const float4*>(&A[(block_row + r) * K + i * BK + a_col]);
    }
    for (int c = 0; c < B_COPIES; c++) {
        int r = b_row + c * b_stride;
        *reinterpret_cast<float4*>(&s_B[r][b_col]) =
            *reinterpret_cast<const float4*>(&B[(i * BK + r) * N + block_col + b_col]);
    }
    __syncthreads();

    // the loop over k is the same as in kernel 5
    ...
}
```

A 16-byte load needs an address that is a multiple of 16 bytes, so the kernel assumes that K and N are multiples of 4.

<details markdown="1">
<summary>SASS of the copies</summary>

Kernel 6 for the B200 (`-O3 -arch=sm_100`), from `cuobjdump -sass`, compiled with the bounds checks. Each thread loads 2 `float4`s of `A` and 2 of `B` with `LDG.E.128`, and stores each with `STS.128`. A thread's two groups of each tile are `0x2000` bytes apart in shared memory, which is 64 rows of `s_A` or 16 rows of `s_B`. The bounds checks turn off a load (`@P` or `@!P`) when its group is outside the matrix, and the store then writes zeros (`RZ`) instead.

```
@P3 IMAD.WIDE.U32 R12, R15, 0x4, R12
@P2 LDC.64 R24, c[0x0][0x388]
@P3 LDG.E.128 R12, desc[UR8][R12.64]
@P0 IMAD.WIDE.U32 R16, R19, 0x4, R16
@P0 LDG.E.128 R16, desc[UR8][R16.64]
@!P1 IMAD.WIDE R20, R23, 0x4, R20
@!P1 LDG.E.128 R20, desc[UR8][R20.64]
@P2 IMAD.WIDE R24, R27, 0x4, R24
@P2 LDG.E.128 R24, desc[UR8][R24.64]
S2UR UR6, SR_CgaCtaId
@!P3 STS.128 [R35], RZ
@!P0 STS.128 [R35+0x2000], RZ
UMOV UR4, 0x400
UIADD3 UR5, UPT, UPT, UR4, 0x4000, URZ
ULEA UR4, UR6, UR4, 0x18
ULEA UR5, UR6, UR5, 0x18
LEA R58, R9, UR4, 0xa
LEA R57, R57, UR5, 0x4
UMOV UR4, 0x188
@P3 STS.128 [R35], R12
@P0 STS.128 [R35+0x2000], R16
@!P2 STS.128 [R36+0x2000], RZ
@!P1 STS.128 [R36], R20
@P1 STS.128 [R36], RZ
@P2 STS.128 [R36+0x2000], R24
BAR.SYNC.DEFER_BLOCKING 0x0
```

</details>

Kernel 6 took 3.45 ms, which is 39.79 TFLOPS and 1.60 times faster than kernel 5. With kernel 5's 64 by 64 tile and 4 by 4 squares, and BK = 16, it took 3.68 ms, so the bigger tile and the longer steps add about 6%, and most of the gain comes from the vector copies.

### What changed

- Each step covers 32 values of `k` instead of 4, so the block takes an eighth as many steps, with an eighth as many `__syncthreads()` and waits for global memory.
- The waits for global memory almost disappear in Nsight Compute, and the waits at `__syncthreads()` fall to about a third.
- Each load from global memory moves 4 numbers, and the bigger tile uses each number for more elements of `C`, so the kernel runs 8 times fewer loads from global memory.
- The pipe that runs the `FFMA`s is busy 55% of the time, up from 37%.
- Shared memory is now the busiest part, at 83%. The most common reason why a warp waits is that the SM picks another warp first, and the next is that the queue of instructions for shared memory is full.

## Kernel 7: transposing s_A

In kernel 6, at each `k` a thread reads TM numbers of `s_A`, one in each of its rows, and TN numbers of `s_B`. The numbers of `s_B` sit next to each other in row `k`, so one vector load reads them. `s_A` stores the tile of `A` row by row, though, so the thread's numbers of `A` for one `k` are in one column, BK numbers apart, and the thread needs one load for each of them.

Kernel 7 stores the tile of `A` transposed in shared memory, with `k` as the row. A thread's numbers of `A` for one `k` then sit next to each other in row `k`, and vector loads read them, as for `s_B`. The copy from global memory still reads 4 neighboring numbers of `A` with one `float4`, but these are neighbors along `k`, so the thread now writes them into 4 different rows of `s_A`, with 4 single stores.

[![Where one thread finds its numbers of A for one k. In kernel 6, s_A stores A row by row, so the thread's numbers for one k are in one column, BK numbers apart, and it needs one load for each. In kernel 7, s_A is stored with k as the row, so the numbers sit next to each other in row k and two vector loads read all of them]({{ '/assets/images/kernel7-transpose.svg' | relative_url }}){: .ia-gpu-overview}]({{ '/assets/images/kernel7-transpose.svg' | relative_url }})

Here are the parts of the kernel that change:

```cpp
// s_A is stored transposed, k first: s_A[k][row] holds A[block_row + row][i * BK + k]
__shared__ __align__(16) float s_A[BK][BM];
...
for (int i = 0; i < K / BK; i++) {
    // the 4 numbers of A are neighbors along k, so they go into 4 different rows of s_A
    for (int c = 0; c < A_COPIES; c++) {
        int r = a_row + c * a_stride;
        float4 a4 = *reinterpret_cast<const float4*>(&A[(block_row + r) * K + i * BK + a_col]);
        s_A[a_col + 0][r] = a4.x;
        s_A[a_col + 1][r] = a4.y;
        s_A[a_col + 2][r] = a4.z;
        s_A[a_col + 3][r] = a4.w;
    }
    // the copies of B are the same as in kernel 6
    ...
    __syncthreads();

    for (int k = 0; k < BK; k++) {
        for (int m = 0; m < TM; m++) reg_A[m] = s_A[k][c_row + m];  // TM neighboring numbers in row k
        for (int n = 0; n < TN; n++) reg_B[n] = s_B[k][c_col + n];
        // the TM x TN FFMAs are the same as in kernel 6
        ...
    }
    __syncthreads();
}
```

<details markdown="1">
<summary>SASS of the copies and the first loads</summary>

Kernel 7 for the B200 (`-O3 -arch=sm_100`), from `cuobjdump -sass`, compiled with the bounds checks. With the 64 by 256 tile below, each thread loads one `float4` of `A` and 4 of `B` with `LDG.E.128`. The 4 numbers of `A` go into 4 rows of `s_A` with 4 `STS` stores, `0x100` bytes apart, which is one row of 64 numbers, and `B` goes into `s_B` with 4 `STS.128`. After the `BAR`, the loads from `s_A` are `LDS.128` loads, like the loads from `s_B`.

```
@P0 LDG.E.128 R12, desc[UR8][R16.64]
...
STS [R3], R12
STS [R3+0x100], R13
STS [R3+0x200], R14
STS [R3+0x300], R15
...
@P1 LDG.E.128 R24, desc[UR8][R24.64]
@P3 IMAD.WIDE R20, R19, 0x4, R20
@!P0 LDG.E.128 R12, desc[UR8][R12.64]
@P2 LDG.E.128 R16, desc[UR8][R16.64]
@P3 LDG.E.128 R20, desc[UR8][R20.64]
@!P2 STS.128 [R5+0x2000], RZ
@!P3 STS.128 [R5+0x4000], RZ
@!P1 STS.128 [R5+0x6000], RZ
...
@P1 STS.128 [R5+0x6000], R24
@!P0 STS.128 [R5], R12
@P2 STS.128 [R5+0x2000], R16
@P3 STS.128 [R5+0x4000], R20
@P0 STS.128 [R5], RZ
BAR.SYNC.DEFER_BLOCKING 0x0
LDS.128 R12, [R8+UR4]
LDS.128 R20, [R3]
LDS.128 R24, [R8+UR6]
LDS.128 R16, [R3+0x400]
FFMA R43, R12.reuse, R20, R43
FFMA R44, R12.reuse, R21, R44
...
```

</details>

Kernel 7 took 3.07 ms, which is 44.80 TFLOPS and 1.13 times faster than kernel 6. Of the same 52 sizes, a 64 by 256 tile with 8 by 4 squares and BK = 32 ran fastest. With kernel 6's size, 128 by 128 and BK = 32, it took 3.32 ms.

### What changed

- At each `k`, a thread reads its numbers of `A` with 2 vector loads instead of 8 single loads. The kernel runs a third as many loads from shared memory, and shared memory does a third less work for them.
- The pipe that runs the `FFMA`s is busy 62% of the time, up from 55%, and the shared memory pipe 73%, down from 83%.
- The most common reason why a warp waits is still that the SM picks another warp first. The queue of instructions for shared memory is full less often, but warps now wait longer for the numbers of each load from shared memory.
- The 8 threads that copy the same row of `A` write into the same bank of shared memory, so the stores into `s_A` take about 3 times as many passes. Stores are rare next to loads, so the cost is small.
- Each thread still needs 64 registers, so 2 blocks of 512 threads fit on an SM, as in kernel 6.

## Kernel 8: double buffering

In kernel 7, each step loads its tiles from global memory, stores them into shared memory, waits at `__syncthreads()`, computes, and waits at `__syncthreads()` again. A warp can't store a tile until its load arrives, so it waits for global memory at every step. The second wait is there because `s_A` and `s_B` hold only one tile each, so no thread may store the next tile while others still read the current one.

Kernel 8 keeps two buffers of each tile in shared memory. While the block computes on one buffer, its threads load the next tile into registers, and after the compute they store it into the other buffer:

[![Kernel 8 with two buffers in shared memory. In step 0, the block computes tile 0 from buffer 0 and stores tile 1 into buffer 1. In step 1, it computes tile 1 from buffer 1 and stores tile 2 into buffer 0, and so on, with one sync at the end of each step]({{ '/assets/images/kernel8-buffers.svg' | relative_url }}){: .ia-gpu-overview}]({{ '/assets/images/kernel8-buffers.svg' | relative_url }})

- A thread starts the loads of the next tile before its loop over `k`. The loop doesn't use the registers that those loads fill, so the loads arrive while the thread computes, and the store after the loop doesn't wait.
- At each step, the threads read one buffer and write the other, so one `__syncthreads()` at the end of the step is enough. After it, the next tile is complete, and every thread is done with the buffer that the step after fills.

[![One warp over one step. In kernel 7, the warp loads a tile, waits for it, stores it, syncs, computes and syncs again. In kernel 8, the warp starts loading the next tile, computes while the tile is on its way, stores it into the other buffer and syncs once]({{ '/assets/images/kernel8-timeline.svg' | relative_url }}){: .ia-gpu-overview}]({{ '/assets/images/kernel8-timeline.svg' | relative_url }})

Two buffers need twice the shared memory, so I tried the 35 sizes from kernel 7 whose two buffers fit in the 48 KB that a block can declare. The next tile also has to wait in registers during the compute, so I ran each size without `__launch_bounds__` and with two settings of it. `__launch_bounds__(NT, B)` tells the compiler that B blocks of NT threads must fit on an SM, so it limits each thread to 65,536 / (B × NT) registers.

A 64 by 256 tile with 8 by 8 squares and BK = 16 ran fastest, with `__launch_bounds__(256, 2)`, which allows up to 128 registers for each thread. Here are the parts of the kernel that change:

```cpp
__global__ void __launch_bounds__(NT, 2) sgemm_8(...) {
    __shared__ __align__(16) float s_A[2][BK][BM];  // two buffers of each tile
    __shared__ __align__(16) float s_B[2][BK][BN];

    // load_tiles loads this thread's float4s of tile i into registers: A_COPIES of A and B_COPIES of B.
    // store_tiles stores them into one buffer, with the stores of kernel 7.
    // before the loop: copy tile 0 into buffer 0
    float4 a4[A_COPIES], b4[B_COPIES];
    load_tiles(0, a4, b4);
    store_tiles(s_A[0], s_B[0], a4, b4);
    __syncthreads();

    for (int i = 0; i < K / BK; i++) {
        int cur = i % 2;  // the buffer that holds tile i

        // start loading tile i + 1. The loop over k doesn't read a4 and b4,
        // so the loads arrive while the thread computes
        if (i + 1 < K / BK) load_tiles(i + 1, a4, b4);

        // the loop over k is the same as in kernel 7, but it reads s_A[cur] and s_B[cur]
        ...

        // store tile i + 1 into the other buffer, which no thread reads at this step
        if (i + 1 < K / BK) store_tiles(s_A[1 - cur], s_B[1 - cur], a4, b4);

        // one wait per step
        __syncthreads();
    }
    ...
}
```

<details markdown="1">
<summary>SASS of one step</summary>

Kernel 8 for the B200 (`-O3 -arch=sm_100`), from `cuobjdump -sass`, compiled with the bounds checks. The 5 `LDG.E.128` loads of the next tile, one of `A` and 4 of `B`, fill `R20` to `R39`. None of the `FFMA`s reads those registers, so the warp first waits for the loads at the `STS` stores after the loop. The compiler runs the loop over `k` as 4 passes of 4 values of `k`, with 256 `FFMA`s in each pass, and there is one `BAR` in each step.

```
@!P2 LDG.E.128 R32, desc[UR12][R46.64]
@!P3 LDG.E.128 R28, desc[UR12][R44.64]
@!P1 LDG.E.128 R20, desc[UR12][R40.64]
@!P4 LDG.E.128 R24, desc[UR12][R42.64]
@!P0 LDG.E.128 R36, desc[UR12][R48.64]
...
LDS.128 R40, [R9+-0x10]
LDS.128 R44, [R9]
LDS.128 R48, [R13+UR4]
LDS.128 R52, [R13+UR4+-0x10]
FFMA R117, R48.reuse, R40, R117
FFMA R115, R48.reuse, R41, R62
...
STS [R9], R36
STS [R9+0x100], R37
STS [R9+0x200], R38
STS [R9+0x300], R39
STS.128 [R12], R32
STS.128 [R12+0x1000], R28
STS.128 [R12+0x2000], R24
STS.128 [R12+0x3000], R20
BAR.SYNC.DEFER_BLOCKING 0x0
```

</details>

Kernel 8 took 2.91 ms, which is 47.22 TFLOPS and 1.05 times faster than kernel 7. Without the launch bound, the same size needs 129 registers, so only 1 block fits on an SM, and it took 3.34 ms. The fastest size with kernel 7's 8 by 4 squares took 2.96 ms.

In kernel 7, 8 by 8 squares were slower than 8 by 4, at 3.23 ms at best. Bigger squares need more registers, so fewer warps fit on an SM, and an SM with fewer warps covers less of the waits for global memory. Double buffering removes most of those waits, so in kernel 8 the bigger squares win.

### What changed

- The waits for global memory almost disappear, and the waits at `__syncthreads()` fall to about a quarter.
- Each thread computes 8 by 8 elements and needs 128 registers. With 2 blocks of 256 threads on an SM, each SM has 16 warps to switch between, half as many as in kernel 7.
- At each `k`, a thread does 64 `FFMA`s for 4 loads from shared memory, instead of 32 for 3, so the kernel runs a third fewer loads from shared memory.
- Shared memory works about 25% more passes than in kernel 7, though, and its pipe is busy 87% of the time.
- The pipe that runs the `FFMA`s is busy 65% of the time, up from 62%.

## Kernel 9: warp tiling

In kernel 8, each thread computes 8 by 8 elements, so the kernel runs a third fewer loads from shared memory than kernel 7. Shared memory still works more passes for those loads, though.

The problem is where a thread's 8 columns sit. In kernel 8 they sit next to each other, so thread 0 reads columns 0 to 7 of `s_B`, and thread 1 reads columns 8 to 15. Neighboring threads then read 32 bytes apart, so several of them hit the same bank, and shared memory needs extra passes for each load.{% include components/sidenote.html id="sn-bank" label="3" text="Shared memory is split into 32 banks, and each bank gives out one 4-byte number per cycle. Number `i` of shared memory sits in bank `i % 32`, so 32 numbers in a row fill each bank once. When threads of one warp load different numbers from the same bank, the bank gives them out one after another, in extra passes. Such a load is called a bank conflict. Threads that load the same number don't conflict, because the bank sends it to all of them at once. In kernel 8, thread 0 loads numbers 0 to 3 of a row of `s_B`, which sit in banks 0 to 3, and thread 4 loads numbers 32 to 35, which sit in banks 0 to 3 as well." %}

Warp tiling keeps the 8 by 8 elements for each thread but spreads them out, so that neighboring threads read neighboring numbers. The name comes from choosing the layout for a whole warp at once, because the 32 threads of a warp load together:

- The 8 warps of a block split the 128 by 128 tile of `C` into pieces of 32 by 64, one for each warp.
- Each warp's piece splits into 4 sub-pieces of 16 by 32. In each sub-piece, the 32 threads sit as 4 rows of 8, and each one computes a 4 by 4 square.
- Each thread computes one square in each of the 4 sub-pieces, which is 8 by 8 elements, and its columns come as two groups of 4 that are 32 columns apart.
- At each `k`, threads 0 to 7 read 8 neighboring groups of 4 numbers of `s_B`, which is one row of 128 bytes, so no two of them hit the same bank.

[![Warp tiling from the block down to one thread. The block's tile of C is split among 8 warps. The piece of warp 0 is split into 4 sub-pieces, and in each one the 32 threads sit as 4 rows of 8 squares, with thread 0 and thread 1 marked in every sub-piece and the numbers of s_A and s_B they read at one k. Thread 0 keeps its 4 squares in registers as 8 by 8 results and updates them from 8 numbers of s_A and 8 of s_B at each k]({{ '/assets/images/kernel9-levels.svg' | relative_url }}){: .ia-gpu-overview}]({{ '/assets/images/kernel9-levels.svg' | relative_url }})

The next picture shows which numbers of `s_B` threads 0 to 7 load at one `k`, in kernel 8 and in kernel 9:

[![Which numbers of s_B threads 0 to 7 load at one k. In kernel 8, a thread's 8 columns sit next to each other, so thread t loads groups 2t and 2t + 1 of 4 numbers, and in the first load threads 0 and 4 both use banks 0 to 3, so the load takes twice the passes. In kernel 9, thread t loads groups t and t + 8, so each load uses every bank once]({{ '/assets/images/kernel9-banks.svg' | relative_url }}){: .ia-gpu-overview}]({{ '/assets/images/kernel9-banks.svg' | relative_url }})

Kernel 9 changes where each thread's elements sit, and its tile of `C` is 128 by 128 instead of 64 by 256. Everything else is the same as in kernel 8:

- Each thread still computes 8 by 8 elements and does 64 `FFMA`s for 4 vector loads from shared memory at each `k`.
- A block still has 256 threads, BK is still 16, and `__launch_bounds__(256, 2)` still lets each thread use up to 128 registers.
- The `float4` copies, the transposed `s_A` and the two buffers are the same.

I tried 268 layouts of tiles, warp pieces and squares, with BK of 8, 16 or 32, each with and without the launch bound. The layout above with BK = 16 and the bound tied for fastest with a 64 by 256 tile. Here are the parts of the kernel that change:

```cpp
#define WM 32      // each warp computes a WM x WN piece of the C tile
#define WN 64
#define TM 4       // each thread computes WMITER x WNITER squares of TM x TN
#define TN 4
#define WMITER 2
#define WNITER 2
#define WSUBM (WM / WMITER)  // a sub-piece is WSUBM x WSUBN = 16 x 32
#define WSUBN (WN / WNITER)

__global__ void __launch_bounds__(256, 2) sgemm_9(const float* A, const float* B, float* C, int M, int K, int N) {
    ...
    // which piece of the C tile this thread's warp computes
    int warp_id = tid / 32;
    int warp_row = (warp_id / (BN / WN)) * WM;
    int warp_col = (warp_id % (BN / WN)) * WN;

    // where this thread's square sits inside each sub-piece: 4 rows of 8 threads,
    // so neighboring threads compute neighboring squares
    int lane = tid % 32;
    int t_row = (lane / (WSUBN / TN)) * TM;
    int t_col = (lane % (WSUBN / TN)) * TN;
    ...
        for (int k = 0; k < BK; k++) {
            for (int wm = 0; wm < WMITER; wm++)
                for (int m = 0; m < TM; m++)
                    reg_A[wm * TM + m] = s_A[cur][k][warp_row + wm * WSUBM + t_row + m];
            for (int wn = 0; wn < WNITER; wn++)
                for (int n = 0; n < TN; n++)
                    reg_B[wn * TN + n] = s_B[cur][k][warp_col + wn * WSUBN + t_col + n];
            // 8 x 8 FFMAs from 8 + 8 numbers
            for (int m = 0; m < WMITER * TM; m++)
                for (int n = 0; n < WNITER * TN; n++)
                    results[m][n] += reg_A[m] * reg_B[n];
        }
    ...
}
```

<details markdown="1">
<summary>SASS of the loop over k</summary>

Kernel 9 for the B200 (`-O3 -arch=sm_100`), from `cuobjdump -sass`, compiled with the bounds checks. The compiler runs the loop over `k` as 4 passes of 4 values of `k`. The first 4 `LDS.128` loads are the 8 numbers of `s_B` (`R56`, `R52`, 128 bytes apart) and the 8 numbers of `s_A` (`R60`, `R40`, 64 bytes apart) for one `k`. The fifth load already reads `s_B` for the next `k`, one row of 512 bytes further on.

```
LDS.128 R56, [R11+-0x80]
UIADD3 UR4, UPT, UPT, UR4, 0x4, URZ
LDS.128 R52, [R11]
UISETP.NE.U32.AND UP0, UPT, UR4, 0x10, UPT
LDS.128 R60, [R20]
LDS.128 R40, [R20+-0x40]
LDS.128 R44, [R11+0x200]
FFMA R103, R60.reuse, R56, R103
FFMA R112, R60.reuse, R57, R112
FFMA R105, R60.reuse, R58, R105
FFMA R114, R60.reuse, R59, R114
FFMA R107, R60.reuse, R52, R107
...
```

</details>

Kernel 9 took 2.67 ms, which is 51.57 TFLOPS and 1.09 times faster than kernel 8. The 64 by 256 tile took the same time, and without the bound, the fastest layout took 2.70 ms.

### What changed

- The bank conflicts of the loads almost disappear, so for the same loads shared memory works 40% fewer passes. Its pipe is busy 63% of the time instead of 87%.
- The waits for shared memory fall by more than half.
- Each thread needs 127 registers. Two blocks of 256 threads fit on an SM, so an SM has 16 warps, as in kernel 8.
- The pipe that runs the `FFMA`s is busy 71% of the time, up from 65%, and the most common reason why a warp waits is still that the SM picks another warp first.

## Results

All times are for M = N = K = 4096 with 32-bit numbers on the B200.

| Kernel | Time (ms) | TFLOPS | % of FP32 speed | % of cuBLAS |
|---|---|---|---|---|
| cuBLAS | 2.16 | 63.60 | 85.4% | 100% |
| 1, 8 × 8 blocks | 66.66 | 2.06 | 2.8% | 3.2% |
| 1, 16 × 16 blocks | 126.61 | 1.09 | 1.5% | 1.7% |
| 1, 32 × 32 blocks | 246.97 | 0.56 | 0.7% | 0.9% |
| 2, 32 × 32 blocks | 19.50 | 7.05 | 9.5% | 11.1% |
| 3, 32 × 32 tiles | 13.32 | 10.32 | 13.9% | 16.2% |
| 4, 16 results per thread | 6.35 | 21.65 | 29.1% | 34.0% |
| 5, 4 × 4 results per thread | 5.53 | 24.86 | 33.4% | 39.1% |
| 6, float4 copies | 3.45 | 39.79 | 53.4% | 62.6% |
| 7, transposed s_A | 3.07 | 44.80 | 60.2% | 70.4% |
| 8, double buffering | 2.91 | 47.22 | 63.4% | 74.2% |
| 9, warp tiling | 2.67 | 51.57 | 69.3% | 81.1% |

## References

1. [Simon Boehm, How to Optimize a CUDA Matmul Kernel for cuBLAS-like Performance: a Worklog](https://siboehm.com/articles/22/CUDA-MMM)
2. [Lei Mao, CUDA Matrix Multiplication Optimization](https://leimao.github.io/article/CUDA-Matrix-Multiplication-Optimization/)
3. [Aleksa Gordić, Inside NVIDIA GPUs: Anatomy of high performance matmul kernels](https://www.aleksagordic.com/blog/matmul)
4. [NVIDIA, CUTLASS: Fast Linear Algebra in CUDA C++](https://developer.nvidia.com/blog/cutlass-linear-algebra-cuda/)
