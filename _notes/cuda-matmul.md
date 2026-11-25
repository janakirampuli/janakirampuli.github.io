---
layout: notes
title: "CUDA kernels and matrix multiplication"
description: "Writing GPU programs in CUDA: threads, blocks and grids in code, what the compiler makes of a kernel, and eleven matrix multiplication kernels on a B200, from a naive kernel to about 90% of cuBLAS."
date: 2026-11-25
tags: ["gpu", "cuda", "matmul"]
project: gpu-programming
part: 2
published: true
extra_css:
  - /assets/css/transformer.css
  - /assets/css/gpu.css
---

The work in this log is inspired by the blogs of [Simon Boehm](https://siboehm.com/articles/22/CUDA-MMM) and [Aleksa Gordić](https://www.aleksagordic.com/blog/matmul).

## Contents

<div class="ia-toc" markdown="1">

- [A kernel](#a-kernel)
- [Starting a kernel from the CPU](#starting-a-kernel-from-the-cpu)
- [From CUDA to machine instructions](#from-cuda-to-machine-instructions)
- [B200](#b200)
- [Matrix multiplication](#matrix-multiplication)
- [cuBLAS reference](#cublas-reference)
- [Kernel 1: one thread for each element](#kernel-1-one-thread-for-each-element)
- [Kernel 2: reading neighboring numbers](#kernel-2-reading-neighboring-numbers)
- [Kernel 3: shared memory](#kernel-3-shared-memory)
- [Kernel 4: a column of results for each thread](#kernel-4-a-column-of-results-for-each-thread)
- [Kernel 5: a square of results for each thread](#kernel-5-a-square-of-results-for-each-thread)
- [Kernel 6: vectorized loads](#kernel-6-vectorized-loads)
- [Kernel 7: transposing s_A](#kernel-7-transposing-s_a)
- [Kernel 8: double buffering](#kernel-8-double-buffering)
- [Kernel 9: warp tiling](#kernel-9-warp-tiling)
- [Kernel 10: two multiply-adds in one instruction](#kernel-10-two-multiply-adds-in-one-instruction)
- [Kernel 11: loading the next numbers ahead](#kernel-11-loading-the-next-numbers-ahead)
- [Where kernel 11 ends up](#where-kernel-11-ends-up)
- [Results](#results)
- [References](#references)

</div>

## A kernel

A kernel is a function that runs on the GPU. The CPU [starts it]({{ '/notes/gpu.html#what-happens-when-the-cpu-starts-a-kernel' | relative_url }}) with a grid of blocks, and every thread in every block runs the whole function, so each thread needs a way to find its own part of the work. CUDA gives each thread four built-in values for that:

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

The program file holds the SASS for the generations that it was compiled for, and it can also hold the PTX. On a newer GPU with no matching SASS, the driver turns the PTX into SASS when the program starts, so an old program still runs on a new GPU. The flag `--ptxas-options=-v` makes `nvcc` print how many registers each kernel uses.

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

Each thread runs every instruction in the listing. The GPU runs the threads of a block in groups of 32, called warps, and the 32 threads of a warp run each instruction together. The values `c[0x0][...]` come from a small read-only memory called constant memory, which holds the kernel's arguments `n`, `a`, `x` and `y` and the block size.

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

## cuBLAS reference

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
            tmp += A[i * K + k] * B[k * N + j];
        }
        C[i * N + j] = tmp;
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

4096 is a multiple of 32, so every thread of the grid has an element to compute. With M = 4100, the grid would need one more row of blocks for the last 4 rows of `C`, and 28 of the 32 rows of threads in those blocks would have nothing to do.

| Block | Time (ms) | TFLOPS | % of cuBLAS |
|---|---|---|---|
| 8 × 8 | 66.66 | 2.06 | 3.2% |
| 16 × 16 | 126.61 | 1.09 | 1.7% |
| 32 × 32 | 246.97 | 0.56 | 0.9% |

Kernel 1 is 31 to 114 times slower than cuBLAS. The reason is the way its warps read memory, which depends on which threads of a block share a warp. The hardware numbers each thread of a block `x + y × blockDim.x`, so `x` changes fastest, and each run of 32 numbers in a row, e.g., 0 to 31, is one warp. In a block of 8 by 8 threads, a warp is 4 rows of 8 threads, and in a block of 16 by 16 threads, it is 2 rows of 16 threads. In a block of 32 by 32 threads, a warp is one row of 32 threads.

[![The threads of a 16 by 16 block, where each warp is 2 rows, and of a 32 by 32 block, where each warp is 1 row]({{ '/assets/images/cuda-warps.svg' | relative_url }}){: .ia-gpu-overview}]({{ '/assets/images/cuda-warps.svg' | relative_url }})

The threads of a warp [read memory together]({{ '/notes/gpu.html#reading-memory-as-a-warp' | relative_url }}). The memory system moves data in pieces of 32 bytes, called sectors, so a read of one 4-byte number still moves 32 bytes. When several threads of a warp read numbers in the same sector, the GPU moves that sector only once for all of them.

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

[![Kernel 3 at step i = 1: the block computes one tile of C. Tile i of its strip of A is in shared memory as s_A and tile i of its strip of B as s_B. Row ty of s_A and column tx of s_B line up with the element in row ty and column tx of the C tile. At the next step, the tile of A moves right and the tile of B moves down, and after the last step the C tile holds the sum of all the tile products]({{ '/assets/images/matmul-kernel3.svg' | relative_url }}){: .ia-gpu-overview}]({{ '/assets/images/matmul-kernel3.svg' | relative_url }})

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

        for (int k = 0; k < 32; k++) {
            sum += s_A[ty][k] * s_B[k][tx];
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

Each block has 1,024 threads and keeps two 32 by 32 tiles in shared memory, which take 8 KB. An SM holds at most 2,048 threads, so it runs 2 blocks at a time and uses 16 KB of its 228 KB of shared memory. The 2 blocks fill all 64 warp places of the SM, so the [occupancy]({{ '/notes/gpu.html#blocks-and-shared-memory' | relative_url }}) is 100%.

The tile can't get bigger while each thread computes one element of `C`, because a block can have at most 1,024 threads, and a 32 by 32 tile already needs all of them.

### Operations and loads

At each step, each thread does 32 `FFMA`s, one for each pair of numbers in its row of `s_A` and its column of `s_B`. Three parts of the GPU each set a highest speed for kernel 3:

- The FP32 cores allow the full FP32 speed of 74.45 TFLOPS.
- Global memory allows almost as much. Each number that a block copies into shared memory is used by 32 threads, so kernel 3 does 8 FLOPs for each byte that it loads, 32 times as many as kernel 2. 8 FLOPs per byte is close to the ridge point, and the L2 cache serves many of the loads.
- Shared memory allows the least. For each `FFMA`, a thread also loads a number of `s_B` from shared memory, and shared memory serves those loads much more slowly than the FP32 cores run the `FFMA`s. For one warp, the 32 `FFMA`s of a step take 8 cycles of the FP32 cores and about 48 cycles of shared memory.

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

Here is the work of one block. From here on, the code leaves out the bounds checks, and `A[r][c]` stands for `A[r * K + c]`:

```cpp
// Compute a BM x BN = 64 x 64 tile of C with 64 x 4 threads
// Each thread computes a column of TM = 16 numbers of the tile, from (c_row, c_col) down
__shared__ float s_A[BM][BK], s_B[BK][BN];   // BK = 4: one number of each for every thread

// Registers for this thread's column of C
float results[TM] = {};

// Iterate over BK-wide chunks of k
for (int k0 = 0; k0 < K; k0 += BK) {
    // ... load A's chunk [BM, BK] into s_A, one number per thread ...
    // ... load B's chunk [BK, BN] into s_B, one number per thread ...
    __syncthreads();

    for (int k = 0; k < BK; k++) {
        // Read one number of s_B and use it for all TM results of the column
        float b = s_B[k][c_col];
        for (int r = 0; r < TM; r++)
            results[r] += s_A[c_row + r][k] * b;
    }

    // Every thread is done with s_A and s_B before the next chunk overwrites them
    __syncthreads();
}
// ... write registers results[..] to C ...
```

Kernel 4 took 6.35 ms, which is 21.65 TFLOPS and 2.10 times faster than kernel 3.

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

[![Busy time of one warp for 64 FFMAs. The FP32 cores need 16 cycles. Shared memory needs 96 cycles in kernel 3, which is 2 steps of 48, and 36 cycles in kernel 4, so it still takes longer than the FP32 cores in both]({{ '/assets/images/kernel4-busy.svg' | relative_url }}){: .ia-gpu-overview}]({{ '/assets/images/kernel4-busy.svg' | relative_url }})

Shared memory still takes longer than the FP32 cores, so it still sets the limit, but by much less than in kernel 3. Global memory doesn't set the limit, because each number that a block copies into shared memory is now used for 64 elements of `C` instead of 32. Kernel 4 does twice as many FLOPs for each byte as kernel 3, which puts it above the ridge point.

Nsight Compute, NVIDIA's profiler, measures where the time of a kernel goes. For kernel 4 it shows:

- Shared memory works for 36 cycles at each step of a warp, which is where the 2 cycles for each load of 4 numbers come from.
- The shared memory pipe is busy 87% of the time and the FP32 cores 31%, so shared memory is the busiest part.
- The most common reasons why a warp can't run its next instruction are waiting for its numbers from global memory, waiting for its numbers from shared memory, and waiting at `__syncthreads()`.

Each thread uses a number of `s_B` for all of its results, but it uses each number of `s_A` for only one result. A thread could compute a square of results instead of a column, so that it reuses the numbers of `s_A` as well, which is called 2D tiling. 2D tiling cuts the loads from shared memory, which set the limit in kernel 4.

## Kernel 5: a square of results for each thread

In kernel 5, each thread computes a small square of elements of `C`, a few rows by a few columns. At each `k`, the thread reads the numbers of `s_A` in its rows and the numbers of `s_B` in its columns into registers. It then multiplies every number of `s_A` with every number of `s_B`, so each number of `s_A` is used for a whole row of its square, and each number of `s_B` for a whole column.

The steps along the strips are the same as in kernel 4, and only the math at each `k` changes.

[![Kernel 5 at one k: one thread computes a small square of C. It reads the numbers of s_A in column k and its rows, and the numbers of s_B in row k and its columns, multiplies every pair and adds each product to the element of its square in the same row and column. The next thread computes the next square]({{ '/assets/images/matmul-kernel5.svg' | relative_url }}){: .ia-gpu-overview}]({{ '/assets/images/matmul-kernel5.svg' | relative_url }})

Here is the work of one block:

```cpp
// Compute a 64 x 64 tile of C with 16 x 16 threads
// Each thread computes a TM x TN = 4 x 4 square of the tile, with its corner at (c_row, c_col)
float results[TM][TN] = {};
float reg_A[TM];  // column k of s_A, in this thread's rows
float reg_B[TN];  // row k of s_B, in this thread's columns

// Iterate over BK-wide chunks of k, as in kernel 4
for (int k0 = 0; k0 < K; k0 += BK) {
    // ... load A's chunk [BM, BK] into s_A and B's chunk [BK, BN] into s_B ...
    __syncthreads();

    for (int k = 0; k < BK; k++) {
        // Read this thread's TM numbers of s_A and TN numbers of s_B into registers
        for (int m = 0; m < TM; m++) reg_A[m] = s_A[c_row + m][k];
        for (int n = 0; n < TN; n++) reg_B[n] = s_B[k][c_col + n];

        // Multiply every number of reg_A with every number of reg_B:
        // TM x TN FFMAs from TM + TN loads
        for (int m = 0; m < TM; m++)
            for (int n = 0; n < TN; n++)
                results[m][n] += reg_A[m] * reg_B[n];
    }
    __syncthreads();
}
// ... write registers results[..][..] to C ...
```

Kernel 5 took 5.53 ms, which is 24.86 TFLOPS and 1.15 times faster than kernel 4.

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

[![Busy time of one warp for 64 FFMAs. The FP32 cores need 16 cycles in each kernel. Shared memory needs 96 cycles in kernel 3, which is 2 steps of 48, 36 in kernel 4 and 24 in kernel 5, so it still takes longer than the FP32 cores in all three]({{ '/assets/images/kernel5-busy.svg' | relative_url }}){: .ia-gpu-overview}]({{ '/assets/images/kernel5-busy.svg' | relative_url }})

Shared memory still takes longer than the FP32 cores, but the gap is smaller than in kernel 4. Nsight Compute shows the pipe that runs the `FFMA`s busy 37% of the time and shared memory 74%. With BK = 4, a warp does only 64 `FFMA`s at each step, between its waits for memory and at `__syncthreads()`.

## Kernel 6: vectorized loads

In kernel 5, each thread copies one number of `A` and one number of `B` at each step, so a tile holds exactly one number for each thread. A block has 256 threads, so a tile of `A` is 64 rows by only 4 columns, and each step covers 4 values of `k`. Every step ends with a wait for global memory and the waits at `__syncthreads()`, and with such short steps a warp spends much of its time waiting.

Kernel 6 makes the steps longer by changing only how the threads copy the tiles. The loop that computes the results stays the same as in kernel 5. The copy changes in two ways:

1. Each copy moves 4 neighboring numbers of a row. CUDA has a type `float4` that holds 4 floats, so one 16-byte load reads the 4 numbers from global memory, and one 16-byte store writes them into shared memory. A load that moves several numbers with one instruction is called a vector load.
2. A thread can copy several groups of 4 at each step, one after another. A tile then doesn't have to hold one copy for each thread, so the size of the tile and BK can be chosen freely.

Neighboring threads still copy neighboring groups, so the reads of a warp stay coalesced.

Kernel 6 uses a 128 by 128 tile with BK = 32 and 512 threads in a block, so each thread copies 2 groups of `A` and 2 groups of `B` at each step.

[![One step of the loop over k has four parts. The threads copy a tile of A and a tile of B into shared memory, wait at __syncthreads(), do the math for the BK values of k in the tiles, and wait at __syncthreads() again before they move to the next tiles. A block takes K / BK steps. The second part of the figure shows what the threads copy into s_A in the first part of a step. In kernel 5, s_A is 64 rows by 4 columns, and each of the 256 threads copies one number, so a step covers 4 values of k. In kernel 6, s_A is 128 rows by 32 columns, and each of the 512 threads copies a group of 4 neighboring numbers in rows 0 to 63 and a second group in the same columns 64 rows further down, so a step covers 32 values of k. Along the first 128 values of k, kernel 5 takes 32 steps and kernel 6 takes 4]({{ '/assets/images/kernel6-copy.svg' | relative_url }}){: .ia-gpu-overview}]({{ '/assets/images/kernel6-copy.svg' | relative_url }})

Here are the parts of the kernel that change. `X[r][c : + 4]` stands for 4 neighboring numbers that one 16-byte `float4` load or store moves:

```cpp
// A float4 store into shared memory needs a 16-byte boundary
__shared__ __align__(16) float s_A[BM][BK], s_B[BK][BN];

// Iterate over BK-wide chunks of k
for (int k0 = 0; k0 < K; k0 += BK) {
    // Load A's chunk [BM, BK] into s_A in groups of 4 neighboring numbers.
    // The NT = 512 threads take the groups in order, so neighboring threads copy neighboring groups,
    // and each thread takes another group NT groups later, which is 64 rows further down
    for (int g = tid; g < BM * BK / 4; g += NT) {
        int r = g / (BK / 4), c = (g % (BK / 4)) * 4;
        s_A[r][c : + 4] = A[block_row + r][k0 + c : + 4];
    }
    // ... load B's chunk [BK, BN] into s_B the same way ...
    __syncthreads();

    // ... the loop over k of kernel 5 ...
}
```

A 16-byte load needs an address that is a multiple of 16 bytes, so the kernel assumes that K and N are multiples of 4.

Kernel 6 took 3.45 ms, which is 39.79 TFLOPS and 1.60 times faster than kernel 5.

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
// s_A holds A's chunk transposed, with k as the row: s_A[k][r] = A[block_row + r][k0 + k]
__shared__ __align__(16) float s_A[BK][BM];

// Iterate over BK-wide chunks of k
for (int k0 = 0; k0 < K; k0 += BK) {
    // Load A's chunk with float4 loads, as in kernel 6. The 4 numbers are neighbors along k,
    // so they go into 4 different rows of s_A with 4 single stores
    for (int g = tid; g < BM * BK / 4; g += NT) {
        int r = g / (BK / 4), c = (g % (BK / 4)) * 4;
        float4 a4 = A[block_row + r][k0 + c : + 4];
        s_A[c + 0][r] = a4.x;
        s_A[c + 1][r] = a4.y;
        s_A[c + 2][r] = a4.z;
        s_A[c + 3][r] = a4.w;
    }
    // ... load B's chunk into s_B, as in kernel 6 ...
    __syncthreads();

    for (int k = 0; k < BK; k++) {
        // This thread's TM numbers of A for this k now sit side by side in row k,
        // so vector loads read them, as for s_B
        for (int m = 0; m < TM; m++) reg_A[m] = s_A[k][c_row + m];
        for (int n = 0; n < TN; n++) reg_B[n] = s_B[k][c_col + n];
        // ... the TM x TN FFMAs of kernel 5 ...
    }
    __syncthreads();
}
```

Kernel 7 took 3.07 ms, which is 44.80 TFLOPS and 1.13 times faster than kernel 6. It uses a 64 by 256 tile, so a row of `s_A` holds 64 numbers.

### Shared memory banks

The stores into `s_A` in kernel 7 run slower than they could, because of how shared memory is built. Shared memory is split into 32 banks, and in each pass, each bank gives out or takes in one 4-byte number. Number `i` of shared memory sits in bank `i % 32`. A warp that reads 32 neighboring numbers therefore uses each bank once, and it gets them all in one pass.

When threads of one warp use different numbers in the same bank, the bank serves them one after another, in extra passes. Such an access is called a bank conflict. Threads that read the same number don't conflict, because the bank sends that number to all of them at once.

In the copy of kernel 7, each thread loads 4 neighboring numbers of one row of `A` with a `float4`, and the 4 numbers are 4 values of `k`. A row of the tile has 32 values of `k`, so 8 threads cover one row, and the 32 threads of a warp cover 4 rows. In `s_A`, row `r` of `A` becomes column `r`. A row of `s_A` holds 64 numbers, which is two rounds of the 32 banks, so all the numbers in column `r` sit in bank `r`.

Each thread stores its 4 numbers with 4 single stores. In the first store of the warp, the 8 threads of each row of `A` all write into the same column of `s_A`, so the 32 stores land in only 4 banks, 8 in each. The store takes 8 passes instead of 1, and so do the other 3.

[![Banks of shared memory. A warp that reads 32 neighboring numbers uses each of the 32 banks once and takes 1 pass. In kernel 7, one warp copies rows 0 to 3 of the tile of A, and each thread loads 4 neighboring values of k with a float4, so threads 0 to 7 cover row 0, threads 8 to 15 row 1, and so on. In s_A, row r of A becomes column r, and column r is in bank r in every row. The first store of the warp writes rows k = 0, 4, 8 and so on up to 28 of columns 0 to 3, all in banks 0 to 3]({{ '/assets/images/kernel7-banks.svg' | relative_url }}){: .ia-gpu-overview}]({{ '/assets/images/kernel7-banks.svg' | relative_url }})

### Swizzling

A common fix for a bank conflict is swizzling. Each row of shared memory keeps the same numbers, but in a different order, and the order changes from row to row. The numbers of one column of the matrix then land in different banks, while a row still uses each bank once.

[![Swizzling on a small shared memory with 8 banks, holding an 8 by 8 matrix row by row. Each column of the matrix has its own color. In the plain layout, each column sits in one bank, so reading a column takes 8 passes. In the swizzled layout, each row holds the same numbers in a different order, and every column has one number in each bank, so reading a column takes 1 pass]({{ '/assets/images/smem-swizzle.svg' | relative_url }}){: .ia-gpu-overview}]({{ '/assets/images/smem-swizzle.svg' | relative_url }})

Kernel 7 keeps the plain layout. Its stores into `s_A` happen once for each tile, while its loads from shared memory happen at every `k`, so the conflict in the stores costs little.

### What changed

- At each `k`, a thread reads its numbers of `A` with 2 vector loads instead of 8 single loads. The kernel runs a third as many loads from shared memory, and shared memory does a third less work for them.
- The pipe that runs the `FFMA`s is busy 62% of the time, up from 55%, and the shared memory pipe 73%, down from 83%.
- The most common reason why a warp waits is still that the SM picks another warp first. The queue of instructions for shared memory is full less often, but warps now wait longer for the numbers of each load from shared memory.
- Only the stores into `s_A` have the bank conflict, and the stores into `s_B` still take one pass each. All the stores into shared memory together take about 3 times as many passes as in kernel 6. Stores are rare next to loads, so the cost is small.
- Each thread still needs 64 registers, so 2 blocks of 512 threads fit on an SM, as in kernel 6.

## Kernel 8: double buffering

In kernel 7, each step loads its tiles from global memory, stores them into shared memory, waits at `__syncthreads()`, computes, and waits at `__syncthreads()` again. A warp can't store a tile until its load arrives, so it waits for global memory at every step. The second wait is there because `s_A` and `s_B` hold only one tile each, so no thread may store the next tile while others still read the current one.

Kernel 8 keeps two buffers of each tile in shared memory. While the block computes on one buffer, its threads load the next tile into registers, and after the compute they store it into the other buffer:

[![Kernel 8 with two buffers in shared memory. In step 0, the block computes tile 0 from buffer 0, while its threads load tile 1 and then store it into buffer 1. In step 1, it computes tile 1 from buffer 1 and loads and stores tile 2 into buffer 0, and so on, with one sync at the end of each step]({{ '/assets/images/kernel8-buffers.svg' | relative_url }}){: .ia-gpu-overview}]({{ '/assets/images/kernel8-buffers.svg' | relative_url }})

- A thread starts the loads of the next tile before its loop over `k`. The loop doesn't use the registers that those loads fill, so the loads arrive while the thread computes, and the store after the loop doesn't wait.
- At each step, the threads read one buffer and write the other, so one `__syncthreads()` at the end of the step is enough. After it, the next tile is complete, and every thread is done with the buffer that the step after fills.

[![One warp over one step. In kernel 7, the warp loads a tile, waits for it, stores it, syncs, computes and syncs again. In kernel 8, the warp starts loading the next tile, computes while the tile is on its way, stores it into the other buffer and syncs once]({{ '/assets/images/kernel8-timeline.svg' | relative_url }}){: .ia-gpu-overview}]({{ '/assets/images/kernel8-timeline.svg' | relative_url }})

The next tile waits in registers while the thread computes, so each thread needs more registers. `__launch_bounds__(NT, 2)` in the code tells the compiler to use few enough registers that 2 blocks fit on an SM. Here are the parts of the kernel that change:

```cpp
__global__ void __launch_bounds__(NT, 2) sgemm_8(...) {
    // Two buffers of each tile: the block computes from one while it fills the other
    __shared__ __align__(16) float s_A[2][BK][BM];
    __shared__ __align__(16) float s_B[2][BK][BN];

    // ... load chunk 0 of A and B into buffer 0, with the copies of kernel 7 ...
    __syncthreads();

    // Iterate over BK-wide chunks of k
    for (int i = 0; i < K / BK; i++) {
        int cur = i % 2;  // the buffer that holds chunk i

        // Start loading chunk i + 1 from global memory into registers.
        // The math below doesn't read those registers, so the loads arrive while the thread computes
        if (i + 1 < K / BK) {
            // ... a4[..], b4[..] = this thread's float4s of chunk i + 1 ...
        }

        // ... the loop over k of kernel 7, reading s_A[cur] and s_B[cur] ...

        // Store chunk i + 1 into the other buffer, which no thread reads at this step
        if (i + 1 < K / BK) {
            // ... s_A[1 - cur], s_B[1 - cur] = a4[..], b4[..], with the copies of kernel 7 ...
        }

        // One wait per step instead of two. After it, chunk i + 1 is complete,
        // and every thread is done with buffer cur, which the next step fills
        __syncthreads();
    }
    ...
}
```

Kernel 8 took 2.91 ms, which is 47.22 TFLOPS and 1.05 times faster than kernel 7.

Kernel 8 uses squares of 8 by 8 results for each thread, while kernel 7 ran faster with 8 by 4. Bigger squares need more registers, so fewer warps fit on an SM, and an SM with fewer warps covers less of the waits for global memory. Double buffering removes most of those waits, so in kernel 8 the bigger squares win.

### What changed

- The waits for global memory almost disappear, and the waits at `__syncthreads()` fall to about a quarter.
- Each thread computes 8 by 8 elements and needs 128 registers. With 2 blocks of 256 threads on an SM, each SM has 16 warps to switch between, half as many as in kernel 7.
- At each `k`, a thread does 64 `FFMA`s for 4 loads from shared memory, instead of 32 for 3, so the kernel runs a third fewer loads from shared memory.
- Shared memory works about 25% more passes than in kernel 7, though, and its pipe is busy 87% of the time.
- The pipe that runs the `FFMA`s is busy 65% of the time, up from 62%.

## Kernel 9: warp tiling

In kernel 8, each thread computes 8 by 8 elements, so the kernel runs a third fewer loads from shared memory than kernel 7. Shared memory still works more passes for those loads, though.

The problem is where a thread's 8 columns sit. In kernel 8 they sit next to each other, so thread 0 reads columns 0 to 7 of `s_B`, and thread 1 reads columns 8 to 15. Neighboring threads then read 32 bytes apart, so several of them hit the [same bank](#shared-memory-banks), and shared memory needs extra passes for each load. For example, thread 0 loads numbers 0 to 3 of a row of `s_B`, which sit in banks 0 to 3, and thread 4 loads numbers 32 to 35, which sit in banks 0 to 3 as well.

Warp tiling keeps the 8 by 8 elements for each thread but spreads them out, so that neighboring threads read neighboring numbers. The name comes from choosing the layout for a whole warp at once, because the 32 threads of a warp load together:

- The 8 warps of a block split the 128 by 128 tile of `C` into pieces of 32 by 64, one for each warp.
- Each warp's piece splits into 4 sub-pieces of 16 by 32. In each sub-piece, the 32 threads sit as 4 rows of 8, and each one computes a 4 by 4 square.
- Each thread computes one square in each of the 4 sub-pieces, which is 8 by 8 elements, and its columns come as two groups of 4 that are 32 columns apart.
- At each `k`, threads 0 to 7 read 8 neighboring groups of 4 numbers of `s_B`, which is one row of 128 bytes, so no two of them hit the same bank. Threads 8 to 31 sit in the same columns of their sub-piece as threads 0 to 7, so they read the same numbers of `s_B`, and the banks send those numbers to all of them at once.

[![Warp tiling from the block down to one thread. The block's tile of C is split among 8 warps. The piece of warp 0 is split into 4 sub-pieces, and in each one the 32 threads sit as 4 rows of 8 squares of 4 by 4, each cell labeled with its thread. Above the piece, each cell of s_B is 4 numbers and is labeled with the thread that loads it, 0 to 7 and then 0 to 7 again. Thread 0 has a square in each sub-piece, so it loads 2 groups of s_B and 2 of s_A at each k. It keeps its 4 squares in registers as 8 by 8 results and updates them from 8 numbers of s_A and 8 of s_B]({{ '/assets/images/kernel9-levels.svg' | relative_url }}){: .ia-gpu-overview}]({{ '/assets/images/kernel9-levels.svg' | relative_url }})

The next picture shows which numbers of `s_B` threads 0 to 7 load at one `k`, in kernel 8 and in kernel 9:

[![Which banks threads 0 to 7 use in their first load of s_B. Each box is 4 neighboring numbers, and 8 boxes fill the 32 banks. In kernel 8, thread t loads boxes 2t and 2t + 1, so in the first load threads 0 and 4 both use banks 0 to 3, and so do 1 and 5, 2 and 6, and 3 and 7, and the load takes 2 passes. In kernel 9, thread t loads boxes t and t + 8, so in each load every thread has banks of its own, and the load takes 1 pass]({{ '/assets/images/kernel9-banks.svg' | relative_url }}){: .ia-gpu-overview}]({{ '/assets/images/kernel9-banks.svg' | relative_url }})

Kernel 9 changes where each thread's elements sit, and its tile of `C` is 128 by 128 instead of 64 by 256. Everything else is the same as in kernel 8:

- Each thread still computes 8 by 8 elements and does 64 `FFMA`s for 4 vector loads from shared memory at each `k`.
- A block still has 256 threads, and the launch bound still lets 2 blocks fit on an SM.
- The `float4` copies, the transposed `s_A` and the two buffers are the same.

Here are the parts of the kernel that change:

```cpp
// Split the 128 x 128 tile among the 8 warps: 4 rows of 2 pieces of 32 x 64
int warp = tid / 32, lane = tid % 32;
int warp_row = (warp / 2) * 32;
int warp_col = (warp % 2) * 64;

// Split each warp's piece into 2 x 2 sub-pieces of 16 x 32. In each sub-piece the 32 lanes
// sit as 4 rows of 8, and each lane computes a 4 x 4 square, so neighbors compute neighbors
int t_row = (lane / 8) * 4;
int t_col = (lane % 8) * 4;

// ... Iterate over BK-wide chunks of k with the two buffers of kernel 8 ...
    for (int k = 0; k < BK; k++) {
        // Read this lane's 4 numbers of s_A in each of the 2 sub-pieces along m, 16 rows apart
        for (int wm = 0; wm < 2; wm++)
            for (int m = 0; m < 4; m++)
                reg_A[wm * 4 + m] = s_A[cur][k][warp_row + wm * 16 + t_row + m];
        // Read this lane's 4 numbers of s_B in each of the 2 sub-pieces along n, 32 columns apart
        for (int wn = 0; wn < 2; wn++)
            for (int n = 0; n < 4; n++)
                reg_B[wn * 4 + n] = s_B[cur][k][warp_col + wn * 32 + t_col + n];

        // 8 x 8 FFMAs from 8 + 8 numbers
        for (int m = 0; m < 8; m++)
            for (int n = 0; n < 8; n++)
                results[m][n] += reg_A[m] * reg_B[n];
    }
// ... write registers results[..][..] to C ...
```

Kernel 9 took 2.67 ms, which is 51.57 TFLOPS and 1.09 times faster than kernel 8.

### What changed

- The bank conflicts of the loads almost disappear, so for the same loads shared memory works 40% fewer passes. Its pipe is busy 63% of the time instead of 87%.
- The waits for shared memory fall by more than half.
- Each thread needs 127 registers. Two blocks of 256 threads fit on an SM, so an SM has 16 warps, as in kernel 8.
- The pipe that runs the `FFMA`s is busy 71% of the time, up from 65%, and the most common reason why a warp waits is still that the SM picks another warp first.

## Kernel 10: two multiply-adds in one instruction

Kernel 9 reaches 69% of the FP32 speed, and cuBLAS reaches 85%. The limit is the scheduler. Each quarter of an SM has [one scheduler]({{ '/notes/gpu.html#sms' | relative_url }}), which starts one instruction for one warp on each tick, and 32 FP32 cores, so one `FFMA` for a warp fills the FP32 cores of the quarter for one tick. To keep the FP32 cores busy on every tick, the scheduler would have to start an `FFMA` on every tick. Each other instruction, e.g., a load from shared memory, an addition for an address or the branch at the end of the loop, takes a tick away from the FP32 cores.

The B200 has an instruction called `FFMA2`, which does two multiply-adds in each thread. It treats two 32-bit numbers in two neighboring registers as a pair, multiplies a pair by a second pair and adds the two products to a third pair. One `FFMA2` for a warp does 64 multiply-adds, so it keeps the FP32 cores busy for 2 ticks, and the scheduler is free on every other tick for the other instructions. Nsight Compute shows that cuBLAS does all of its multiply-adds with `FFMA2`.

In kernel 10, each thread keeps its 8 rows of results as 4 pairs of neighboring rows. At each `k`, the thread loads its numbers of `s_A` as 4 pairs, and one `FFMA2` multiplies a pair by one number of `s_B` and adds the two products to the two results in that column.

[![FFMA and FFMA2 for one thread at one k. In kernel 9, one FFMA multiplies one number of s_A by one number of s_B and adds the product to one result, so a thread runs 64 FFMAs at each k. In kernel 10, one FFMA2 multiplies a pair of numbers of s_A from 2 neighboring rows by one number of s_B and adds the products to 2 results, so a thread runs 32 FFMA2s at each k. Below, one scheduler tick by tick: in kernel 9, each LDS, add or branch takes a tick away from the FP32 cores, and in kernel 10, each FFMA2 keeps the FP32 cores busy for 2 ticks, so the other instructions fit in between]({{ '/assets/images/kernel10-ffma2.svg' | relative_url }}){: .ia-gpu-overview}]({{ '/assets/images/kernel10-ffma2.svg' | relative_url }})

CUDA has `FFMA2` as the function `__ffma2_rn`, which takes three `float2`s, a CUDA type that holds 2 floats. Each half rounds the same way as an `FFMA`, so the results are the same as in kernel 9. Kernel 10 uses the sizes of kernel 9. Here are the parts of the kernel that change:

```cpp
// The thread's 8 rows of results as 4 pairs of neighboring rows:
// results[p][n] holds rows 2p and 2p + 1 of column n
float2 results[WMITER * TM / 2][WNITER * TN];
float2 reg_A[WMITER * TM / 2];  // row k of s_A, this thread's rows, in pairs
float  reg_B[WNITER * TN];      // row k of s_B, this thread's columns

// ... Iterate over BK-wide chunks of k with the two buffers of kernel 8 ...
    for (int k = 0; k < BK; k++) {
        // ... load reg_A in pairs and reg_B from s_A[cur] and s_B[cur], as in kernel 9 ...

        // One FFMA2 multiplies a pair of rows of s_A by one number of s_B
        // and adds the products to 2 results: 4 x 8 = 32 FFMA2s for 64 multiply-adds
        for (int p = 0; p < WMITER * TM / 2; p++)
            for (int n = 0; n < WNITER * TN; n++)
                results[p][n] = __ffma2_rn(reg_A[p], make_float2(reg_B[n], reg_B[n]), results[p][n]);
    }
// ... write the pairs of results to C ...
```

Kernel 10 took 2.48 ms, which is 55.34 TFLOPS and 1.08 times faster than kernel 9.

### What changed

- The kernel runs 38% fewer instructions, and the schedulers start an instruction on about half of the ticks instead of 80%.
- The kernel reaches 74% of the FP32 speed, up from 69%, while cuBLAS reaches 85%.
- Each thread needs 119 registers, and an SM still runs 2 blocks of 256 threads.
- cuBLAS is still 15% faster. Its loop over `k` is written out in full, while in kernel 10 each `k` still costs 5 instructions for the loop counter, the addresses and the branch, and some of those run on the same pipe as the `FFMA2`s.

## Kernel 11: loading the next numbers ahead

In kernel 10, a thread loads its numbers of `s_A` and `s_B` for one `k` and uses them right after. A load from shared memory takes some ticks to arrive, so every warp waits at every `k`, and the SM can only cover the wait by running other warps. cuBLAS hardly waits there, because it loads the numbers for the next `k` while the `FFMA2`s for this `k` run.

Kernel 11 does the same. Each thread keeps two sets of registers for its numbers of `s_A` and `s_B`. While the `FFMA2`s for `k` use one set, the loads for `k + 1` fill the other set, so the numbers are ready when the thread gets to `k + 1`. A register has a fixed name in each instruction, so the code can only pick the set `k % 2` if the compiler knows `k`. The loop over `k` is therefore written out in full with `#pragma unroll`.

The second set and the longer loop need more registers. With them, the compiler moved the loads of the next tile from global memory, which kernel 8 starts before the loop over `k`, to after the loop, probably to save the registers that would hold them during the loop. Each step then waited for global memory again. Kernel 11 therefore copies the tiles with asynchronous copies, which CUDA has as `__pipeline_memcpy_async`. An asynchronous copy goes from global memory straight into shared memory without passing through registers, and the thread goes on while the copy is on the way. The kernel keeps 4 buffers of each tile, so the copies of the next 3 tiles can be on the way while the block computes on one.{% include components/sidenote.html id="sn-async" label="3" text="Neither change helps on its own here. Asynchronous copies alone made kernel 10 slower, because kernel 10 hardly waits for global memory, and the copies into the transposed s_A take one instruction for each number. Loading ahead alone also made it slower, because the compiler moved the loads of the next tile behind the loop. Together, the two take kernel 10 from 2.48 to 2.39 ms." %}

[![One warp over one step. In kernel 10, each k loads its numbers from s_A and s_B, waits for them and then runs its 32 FFMA2s, so the FFMA2s stop at every k. In kernel 11, the numbers for k + 1 load while the FFMA2s for k run, so the FFMA2s run without a break. Before the last k, the warp waits for the next tile and syncs, and the numbers of the next tile for k = 0 load while the last FFMA2s run. The asynchronous copies of the next tiles are on the way during the whole step]({{ '/assets/images/kernel11-load-ahead.svg' | relative_url }}){: .ia-gpu-overview}]({{ '/assets/images/kernel11-load-ahead.svg' | relative_url }})

Kernel 11 uses a tile of 64 by 128 with 128 threads in a block, as cuBLAS does. Here are the parts of the kernel that change:

```cpp
// Two sets of registers for the numbers of s_A and s_B.
// load_k(reg_A, reg_B, s_A, s_B, k) reads this thread's numbers of s_A and s_B for one k,
// in pairs for s_A, as in kernel 10
float2 reg_A[2][WMITER * TM / 2];
float  reg_B[2][WNITER * TN];

// ... start the asynchronous copies of tiles 0 to STAGES - 2, wait for tile 0,
//     and load its numbers for k = 0 into set 0 ...

for (int i = 0; i < num_tiles; i++) {
    int cur = i % STAGES;

    // Start copying tile i + STAGES - 1 straight into a free buffer of shared memory,
    // and close the group of copies
    // ... __pipeline_memcpy_async(...) for this thread's numbers of the tile ...
    __pipeline_commit();

    #pragma unroll  // so that k % 2 is known when the program is compiled
    for (int k = 0; k < BK; k++) {
        if (k < BK - 1) {
            // Load the numbers for k + 1 into the other set, while the FFMA2s for k run
            load_k(reg_A[(k + 1) % 2], reg_B[(k + 1) % 2], s_A[cur], s_B[cur], k + 1);
        } else {
            // Before the last k: wait for this thread's copies of tile i + 1, then for every thread,
            // and load the numbers of tile i + 1 for k = 0
            __pipeline_wait_prior(STAGES - 2);
            __syncthreads();
            if (i + 1 < num_tiles)
                load_k(reg_A[0], reg_B[0], s_A[(i + 1) % STAGES], s_B[(i + 1) % STAGES], 0);
        }
        // ... the 32 FFMA2s of kernel 10, with set k % 2 ...
    }
}
```

Kernel 11 took 2.39 ms, which is 57.39 TFLOPS and 1.04 times faster than kernel 10.

### What changed

- The warps wait for their loads from shared memory a third as often as in kernel 10.
- The copies from global memory hold no registers, and the waits for them stay small.
- Each thread needs 148 registers, and 3 blocks of 128 threads fit on an SM, which is 12 warps instead of 16.
- cuBLAS is still 10% faster. It reaches 85% of the FP32 speed, against 77% for kernel 11, and its warps wait less at `__syncthreads()`.

## Where kernel 11 ends up

Nsight Compute sums up a kernel by how busy each part of the GPU is, as a share of the most that the part can do. It calls this share the speed of light.

[![Nsight Compute's GPU Speed Of Light section for kernel 11. Compute (SM) throughput is 77.64%, memory throughput 75.63%, of which the L1/TEX cache and shared memory are 77.09%, the L2 cache 12.60% and DRAM 3.98%. Both bars of the throughput chart stop near 77%]({{ '/assets/images/ncu-kernel11-sol.svg' | relative_url }})]({{ '/assets/images/ncu-kernel11-sol.svg' | relative_url }})

Kernel 11 is limited by the SM itself, not by HBM. The SM is busy about 78% of the time, mostly with `FFMA2`s, and shared memory, which Nsight Compute counts under memory, is busy about 77% of the time. The L2 cache and HBM are almost idle, because each number that comes into shared memory is used many times.

[![Nsight Compute's Warp State Statistics for kernel 11, in cycles per instruction that a warp starts. The largest bars are math pipe throttle at about 1.1, not selected at about 1.1, selected at 1.0 and wait at about 0.9. Short scoreboard, barrier, dispatch stall and long scoreboard are all below 0.35]({{ '/assets/images/ncu-kernel11-warp-state.svg' | relative_url }})]({{ '/assets/images/ncu-kernel11-warp-state.svg' | relative_url }})

The second picture shows where a warp spends its ticks, counted for each instruction that it starts. The two largest reasons are that the FP32 cores of its quarter are still busy with earlier `FFMA2`s, and that another warp of the quarter started an instruction on that tick. In both cases the quarter is already working. The waits for global memory, for shared memory and at `__syncthreads()`, which kernels 6, 8 and 11 went after one by one, are now small.

The rest of the gap is inside the SM:

- Kernel 11 reaches 77% of the FP32 speed and cuBLAS 85%. The other ticks go to instructions other than `FFMA2`, and to the fixed waits between instructions that depend on each other.
- Shared memory is busy about as often as the FP32 cores, so a faster kernel would also need fewer loads from shared memory for each `FFMA2`.

## Results

All times are for M = N = K = 4096 with 32-bit numbers on the B200.

| Kernel | Time (ms) | TFLOPS | % of cuBLAS |
|---|---|---|---|
| cuBLAS | 2.16 | 63.60 | 100% |
| 1, 8 × 8 blocks | 66.66 | 2.06 | 3.2% |
| 1, 16 × 16 blocks | 126.61 | 1.09 | 1.7% |
| 1, 32 × 32 blocks | 246.97 | 0.56 | 0.9% |
| 2, 32 × 32 blocks | 19.50 | 7.05 | 11.1% |
| 3, 32 × 32 tiles | 13.32 | 10.32 | 16.2% |
| 4, 16 results per thread | 6.35 | 21.65 | 34.0% |
| 5, 4 × 4 results per thread | 5.53 | 24.86 | 39.1% |
| 6, float4 copies | 3.45 | 39.79 | 62.6% |
| 7, transposed s_A | 3.07 | 44.80 | 70.4% |
| 8, double buffering | 2.91 | 47.22 | 74.2% |
| 9, warp tiling | 2.67 | 51.57 | 81.1% |
| 10, FFMA2 | 2.48 | 55.34 | 87.0% |
| 11, loading ahead | 2.39 | 57.39 | 90.2% |

## References

1. [Simon Boehm, How to Optimize a CUDA Matmul Kernel for cuBLAS-like Performance: a Worklog](https://siboehm.com/articles/22/CUDA-MMM)
2. [Lei Mao, CUDA Matrix Multiplication Optimization](https://leimao.github.io/article/CUDA-Matrix-Multiplication-Optimization/)
3. [Aleksa Gordić, Inside NVIDIA GPUs: Anatomy of high performance matmul kernels](https://www.aleksagordic.com/blog/matmul)
4. [NVIDIA, CUTLASS: Fast Linear Algebra in CUDA C++](https://developer.nvidia.com/blog/cutlass-linear-algebra-cuda/)
