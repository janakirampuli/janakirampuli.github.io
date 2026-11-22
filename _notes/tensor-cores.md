---
layout: notes
title: "Tensor cores and matrix multiplication"
description: "Matrix multiplication on the tensor cores of a B200, with BF16 inputs and FP32 sums: what a tensor core computes, the mma instruction and its fragments, and the first tensor core kernel."
date: 2026-11-20
tags: ["gpu", "cuda", "matmul", "tensor cores"]
project: gpu-programming
part: 3
published: false
extra_css:
  - /assets/css/transformer.css
  - /assets/css/gpu.css
---

## Contents

<div class="ia-toc" markdown="1">

- [Tensor cores](#tensor-cores)
- [BF16](#bf16)
- [The mma instruction](#the-mma-instruction)
- [Tensor core speed of the B200](#tensor-core-speed-of-the-b200)
- [The cuBLAS reference](#the-cublas-reference)
- [Kernel 1: one warp for each 16 by 8 tile](#kernel-1-one-warp-for-each-16-by-8-tile)
- [Kernel 2](#kernel-2)
- [Results](#results)

</div>

## Tensor cores

In the [previous note]({{ '/notes/cuda-matmul.html' | relative_url }}), every multiply-add of a matrix multiplication was one `FFMA`, and each thread did its own. A tensor core multiplies two small matrices in one instruction instead:

- The 32 threads of a warp issue the instruction together, and the tensor core computes a small matrix product for the whole warp.
- No thread holds a whole matrix. Each thread holds a few numbers of each matrix in its registers, and the instruction reads the registers of all 32 threads at once.
- The inputs are narrower than FP32, BF16 in this note, and the products are added in FP32.

Each SM of the B200 has 4 tensor cores, one for each quarter of the SM, next to the FP32 cores that the previous note used.

## BF16

BF16 is a 16-bit floating point number. It keeps the 8 exponent bits of FP32 and only 7 of its 23 mantissa bits:

| Format | Sign | Exponent | Mantissa | Bytes |
|---|---|---|---|---|
| FP32 | 1 | 8 | 23 | 4 |
| BF16 | 1 | 8 | 7 | 2 |

- BF16 covers the same range of numbers as FP32, because it has the same exponent, but it keeps only about 2 to 3 significant decimal digits. Rounding a number to BF16 changes it by up to 0.4%.
- A BF16 number is the upper half of the FP32 number that it rounds, so converting between the two is cheap.
- The tensor core adds the products in FP32, so the only extra rounding happens once, on the inputs.

The programs in this note round `A` and `B` to BF16 once on the CPU. The spot check compares 100 elements of `C` with an FP64 sum of the same rounded numbers, so it measures only the error of the sums.

## The mma instruction

The instruction that this note uses is `mma.sync`, the warp-level matrix multiply-add of PTX. Its full name says what it computes:

```
mma.sync.aligned.m16n8k16.row.col.f32.bf16.bf16.f32   D, A, B, C
```

- `m16n8k16`: `D` (16 by 8) = `A` (16 by 16) times `B` (16 by 8), plus `C` (16 by 8), which is 16 × 8 × 16 = 2,048 multiply-adds in one instruction.
- `row.col`: `A` is given row by row and `B` column by column, so each thread's numbers of both run along `k`.
- `f32.bf16.bf16.f32`: `D` and `C` are FP32, and `A` and `B` are BF16.

The 32 lanes of the warp hold the four matrices in a fixed layout, which NVIDIA calls fragments. The layout splits the lanes into 8 groups of 4, with `group = lane / 4` and `t = lane % 4`:

| Fragment | Numbers in each lane | Which numbers |
|---|---|---|
| `A`, 16 × 16 | 8 BF16 in 4 registers | rows `group` and `group + 8`, columns `2t`, `2t + 1`, `2t + 8` and `2t + 9` |
| `B`, 16 × 8 | 4 BF16 in 2 registers | column `group`, rows `2t`, `2t + 1`, `2t + 8` and `2t + 9` |
| `C` and `D`, 16 × 8 | 4 FP32 in 4 registers | rows `group` and `group + 8`, columns `2t` and `2t + 1` |

[![Which lane holds which number in mma.m16n8k16. In A, lane 0 holds columns 0, 1, 8 and 9 of rows 0 and 8. In B, lane 0 holds rows 0, 1, 8 and 9 of column 0. In C, lane 0 holds columns 0 and 1 of rows 0 and 8. Each 32-bit register holds 2 neighboring numbers along k]({{ '/assets/images/tc-fragments.svg' | relative_url }}){: .ia-gpu-overview}]({{ '/assets/images/tc-fragments.svg' | relative_url }})

A register has 32 bits, so it holds 2 BF16 numbers, and the first of the two goes into the lower 16 bits. The two numbers in one register are neighbors along `k`, which in `A` means neighbors in a row and in `B` neighbors in a column. Each element of the 16 by 8 result belongs to exactly one lane.

CUDA C++ has no function that issues this instruction with exactly this layout, so the kernels write it as inline PTX with `asm volatile`:

{% raw %}
```cpp
// two BF16 in one 32-bit register, the first in the low 16 bits
__device__ uint32_t pack_bf16(__nv_bfloat16 lo, __nv_bfloat16 hi) {
    return (uint32_t)__bfloat16_as_ushort(lo) | ((uint32_t)__bfloat16_as_ushort(hi) << 16);
}

// the whole warp: c (16 x 8, FP32) += a (16 x 16, BF16) * b (16 x 8, BF16)
// "+f": c is read and written, in FP32 registers. "r": a and b are 32-bit registers
asm volatile("mma.sync.aligned.m16n8k16.row.col.f32.bf16.bf16.f32 "
             "{%0, %1, %2, %3}, {%4, %5, %6, %7}, {%8, %9}, {%0, %1, %2, %3};"
             : "+f"(c[0]), "+f"(c[1]), "+f"(c[2]), "+f"(c[3])
             : "r"(a[0]), "r"(a[1]), "r"(a[2]), "r"(a[3]), "r"(b[0]), "r"(b[1]));
```
{% endraw %}

## Tensor core speed of the B200

NVIDIA lists the B200 at 2,250 TFLOPS for BF16 inputs, which is 30 times the 74.45 TFLOPS of its FP32 cores.{% include components/sidenote.html id="sn-sparse" label="1" text="NVIDIA also lists 4,500 TFLOPS, but only for 2:4 sparsity, where 2 of every 4 numbers of one input are zero and the tensor core skips them. A dense matrix multiplication can reach at most the 2,250." %} The CUDA runtime has no value to compute this speed from, so the programs use the listed figure.

- The ridge point moves from 9.7 FLOPs per byte for the FP32 cores to 2,250 TFLOPS ÷ 7,672 GB per second = 293 FLOPs per byte. A kernel has to use each number that it loads from HBM many more times to keep the tensor cores busy.
- At M = N = K = 4096, the 137 billion operations take at least 0.061 ms. Reading `A` and `B` from HBM once and writing `C` once takes about 0.017 ms. With the FP32 cores, the math took 70 times longer than the reads, and with the tensor cores it takes only about 3.5 times longer.

## The cuBLAS reference

cuBLAS multiplies BF16 matrices with FP32 sums through `cublasGemmEx`:

```cpp
// row-major C = A * B is column-major C^T = B^T * A^T, so B goes first
cublasGemmEx(handle, CUBLAS_OP_N, CUBLAS_OP_N, N, M, K, &alpha,
             d_B, CUDA_R_16BF, N, d_A, CUDA_R_16BF, K, &beta,
             d_C, CUDA_R_32F, N, CUBLAS_COMPUTE_32F, CUBLAS_GEMM_DEFAULT);
```

It took 0.099 ms, which is 1,383 TFLOPS and 61.5% of the listed BF16 speed, and 22 times faster than cuBLAS with FP32 numbers on the FP32 cores. Nsight Compute shows its tensor cores busy about three quarters of the kernel's time. At this size, one product takes only a tenth of a millisecond, and separate runs differed by about 2%.{% include components/sidenote.html id="sn-emulation" label="2" text="cuBLAS can also run the FP32 matrix multiplication of the previous note on the tensor cores. With the environment variable CUBLAS_EMULATE_SINGLE_PRECISION=1, it splits each FP32 number into 3 BF16 numbers and adds up 9 tensor core products. It took 0.84 ms instead of 2.16 ms, and the largest error in the spot check was 6.9e-7, smaller than the 2.7e-6 of cublasSgemm on the FP32 cores." %}

## Kernel 1: one warp for each 16 by 8 tile

The simplest tensor core kernel gives each 16 by 8 tile of `C` its own warp, as kernel 1 of the previous note gave each element its own thread. The warp walks along its 16 rows of `A` and its 8 columns of `B`, 16 values of `k` at a time. At each step, each lane loads its 8 numbers of `A` and 4 numbers of `B` from global memory, packs them in pairs into registers, and the warp issues one `mma`. The 4 sums of each lane stay in registers until the end.

[![Kernel 1: one warp computes one 16 by 8 tile of C. At each step it loads a 16 by 16 piece of its 16 rows of A and a 16 by 8 piece of its 8 columns of B, and the steps move along k]({{ '/assets/images/tc-kernel1.svg' | relative_url }}){: .ia-gpu-overview}]({{ '/assets/images/tc-kernel1.svg' | relative_url }})

Here is the kernel:

```cpp
__global__ void tc_1(const __nv_bfloat16* A, const __nv_bfloat16* B, float* C, int M, int K, int N) {
    // each warp computes one 16 x 8 tile of C
    int tile_row = (blockIdx.y * WARPS + threadIdx.y) * 16;
    int tile_col = blockIdx.x * 8;

    // the fragment layout splits the 32 lanes into 8 groups of 4
    int lane = threadIdx.x;
    int group = lane / 4, t = lane % 4;
    int r0 = tile_row + group, r1 = r0 + 8;   // this lane's rows of A and C
    int col = tile_col + group;               // this lane's column of B

    float c[4] = {0.0f, 0.0f, 0.0f, 0.0f};   // C[r0][2t], C[r0][2t + 1], C[r1][2t], C[r1][2t + 1]
    for (int k0 = 0; k0 < K; k0 += 16) {
        int ka = k0 + 2 * t;
        uint32_t a[4], b[2];
        a[0] = pack_bf16(A[r0 * K + ka],     A[r0 * K + ka + 1]);
        a[1] = pack_bf16(A[r1 * K + ka],     A[r1 * K + ka + 1]);
        a[2] = pack_bf16(A[r0 * K + ka + 8], A[r0 * K + ka + 9]);
        a[3] = pack_bf16(A[r1 * K + ka + 8], A[r1 * K + ka + 9]);
        b[0] = pack_bf16(B[ka * N + col],       B[(ka + 1) * N + col]);
        b[1] = pack_bf16(B[(ka + 8) * N + col], B[(ka + 9) * N + col]);
        // the mma from above: c += a * b for the whole warp
        asm volatile("mma.sync.aligned.m16n8k16.row.col.f32.bf16.bf16.f32 ..." ...);
    }
    C[r0 * N + tile_col + 2 * t]     = c[0];
    C[r0 * N + tile_col + 2 * t + 1] = c[1];
    C[r1 * N + tile_col + 2 * t]     = c[2];
    C[r1 * N + tile_col + 2 * t + 1] = c[3];
}
```

Each block has `WARPS` warps stacked along `M`, so `threadIdx.x` is the lane and `threadIdx.y` the warp in the block:

```cpp
dim3 blockDim(32, WARPS);   // WARPS = 2: a block computes a 32 by 8 piece of C
dim3 gridDim(ceil_div(N, 8), ceil_div(M, 16 * WARPS));
tc_1<<<gridDim, blockDim>>>(d_A, d_B, d_C, M, K, N);
```

<details markdown="1">
<summary>SASS of the loop</summary>

Kernel 1 for the B200 (`-O3 -arch=sm_100`), from `cuobjdump -sass`, compiled with the bounds checks, which add the `ISETP` and `@!P` instructions. The 12 `LDG.E.U16` instructions each load 2 bytes, 8 for `A` and 4 for `B`. Each `PRMT` without a condition puts two of them into one 32-bit register, and each `@P PRMT` sets a number to zero when the bounds check turned its load off. `HMMA.16816.F32.BF16` is the `mma`.

```
ISETP.GE.AND P0, PT, R2, UR11, PT
ISETP.GE.OR P6, PT, R14, UR10, P0
VIADD R22, R2, 0x1
@!UPT UIADD3 URZ, UPT, UPT, URZ, URZ, URZ
@!P6 LDC.64 R12, c[0x0][0x380]
ISETP.GE.AND P2, PT, R22, UR11, PT
ISETP.GE.OR P4, PT, R14, UR10, P2
@!UPT UIADD3 URZ, UPT, UPT, URZ, URZ, URZ
@!P4 LDG.E.U16 R20, desc[UR8][R16.64+-0x10]
@!P6 IMAD.WIDE.U32 R12, R24, 0x2, R12
@!P6 LDG.E.U16 R13, desc[UR8][R12.64]
VIADD R28, R2.reuse, 0x8
VIADD R0, R2, 0x9
ISETP.GE.AND P1, PT, R28, UR11, PT
ISETP.GE.AND P3, PT, R0, UR11, PT
ISETP.GE.OR P5, PT, R6, UR10, P1
ISETP.GE.OR P1, PT, R14, UR10, P1
@!P5 LDG.E.U16 R0, desc[UR8][R18.64+-0x2]
ISETP.GE.OR P2, PT, R6, UR10, P2
@!P1 LDG.E.U16 R12, desc[UR8][R16.64+-0x2]
@P4 PRMT R20, RZ, 0x7610, R20
ISETP.GE.OR P4, PT, R6, UR10, P0
@P6 PRMT R13, RZ, 0x7610, R13
ISETP.GE.OR P6, PT, R6, UR10, P3
ISETP.GE.OR P3, PT, R14, UR10, P3
@!P4 LDC.64 R14, c[0x0][0x380]
@!P6 LDG.E.U16 R25, desc[UR8][R18.64]
PRMT R13, R13, 0x5410, R20
@!P3 LDG.E.U16 R23, desc[UR8][R16.64]
@!P4 IMAD.WIDE.U32 R20, R3, 0x2, R14
@!P4 LDG.E.U16 R29, desc[UR8][R20.64]
@!P2 LDG.E.U16 R20, desc[UR8][R18.64+-0x10]
@P5 PRMT R0, RZ, 0x7610, R0
@P1 PRMT R12, RZ, 0x7610, R12
@P6 PRMT R25, RZ, 0x7610, R25
PRMT R14, R0, 0x5410, R25
S2R R0, SR_TID.X
LDC R25, c[0x0][0x3a0]
@P3 PRMT R23, RZ, 0x7610, R23
PRMT R15, R12, 0x5410, R23
@P4 PRMT R29, RZ, 0x7610, R29
@P2 PRMT R20, RZ, 0x7610, R20
PRMT R12, R29, 0x5410, R20
LEA.HI R20, R0, UR4, RZ, 0x1e
ISETP.GE.OR P0, PT, R20.reuse, R25.reuse, P0
ISETP.GE.AND P1, PT, R20, R25, PT
@!P0 LDC.64 R20, c[0x0][0x388]
ISETP.GE.OR P2, PT, R22, UR11, P1
@!P0 IMAD.WIDE R22, R26, 0x2, R20
@!UPT UIADD3 URZ, UPT, UPT, URZ, URZ, URZ
@!P2 LDC.64 R20, c[0x0][0x388]
ISETP.GE.OR P3, PT, R28, UR11, P1
@!P0 LDG.E.U16 R28, desc[UR8][R22.64]
@!P3 LDC.64 R22, c[0x0][0x388]
@!P2 IMAD.WIDE R20, R4, 0x2, R20
@!P2 LDG.E.U16 R29, desc[UR8][R20.64]
@P0 PRMT R28, RZ, 0x7610, R28
@P2 PRMT R29, RZ, 0x7610, R29
PRMT R20, R28, 0x5410, R29
@!P3 IMAD.WIDE R28, R27, 0x2, R22
VIADD R22, R2, 0x9
@!P3 LDG.E.U16 R21, desc[UR8][R28.64]
ISETP.GE.OR P1, PT, R22, UR11, P1
@!UPT UIADD3 URZ, UPT, UPT, URZ, URZ, URZ
@!P1 LDC.64 R22, c[0x0][0x388]
@!P1 IMAD.WIDE R22, R5, 0x2, R22
@!P1 LDG.E.U16 R22, desc[UR8][R22.64]
UIADD3 UR6, UPT, UPT, UR5, 0x8, URZ
UISETP.GE.AND UP0, UPT, UR6, UR11, UPT
IADD3 R16, P0, PT, R16, 0x20, RZ
IMAD R26, R25.reuse, 0x10, R26
IMAD R4, R25.reuse, 0x10, R4
IMAD.X R17, RZ, RZ, R17, P0
IMAD R27, R25.reuse, 0x10, R27
IMAD R5, R25, 0x10, R5
VIADD R2, R2, 0x10
VIADD R24, R24, 0x10
VIADD R3, R3, 0x10
UIADD3 UR5, UPT, UPT, UR5, 0x10, URZ
@P3 PRMT R21, RZ, 0x7610, R21
@P1 PRMT R22, RZ, 0x7610, R22
PRMT R21, R21, 0x5410, R22
HMMA.16816.F32.BF16 R8, R12, R20, R8
IADD3 R18, P1, PT, R18, 0x20, RZ
IMAD.X R19, RZ, RZ, R19, P1
@!UPT UIADD3 URZ, UPT, UPT, URZ, URZ, URZ
BRA.U !UP0, 0x300
```

</details>

Kernel 1 took 10.29 ms, which is 13.36 TFLOPS and 1.0% of cuBLAS. It is faster than kernel 3 of the previous note, which used shared memory, but slower than its kernel 4. I tried blocks of 1, 2, 4, 8 and 16 warps, and the times differed by less than 3%, with 2 warps fastest.

### Why kernel 1 is slow

At each step, a warp does one `mma`, which is 2,048 multiply-adds, but it needs 12 load instructions from global memory to feed it:

- Each load instruction gives each lane one 2-byte number. The lanes of one load of `A` read 8 different rows, so the warp moves 8 sectors of 32 bytes, and the lanes of one load of `B` read 4 different rows, so it moves 4 sectors.
- In all, the 12 loads move 80 sectors, which is 2,560 bytes, to bring in the 768 bytes of `A` and `B` that the `mma` uses.
- No warp shares its numbers with another warp. Every warp in a row of tiles loads the same rows of `A` from global memory on its own, and every warp in a column of tiles loads the same columns of `B`.

Nsight Compute shows the result:

- The L1 cache, which serves the loads, is busy 99.6% of the time, as in kernel 1 of the previous note.
- The most common reason why a warp waits, by far, is its numbers from global memory.
- The tensor cores are busy only 2.4% of the time.
- The L1 and L2 caches serve almost all the loads, so HBM reads each matrix only about once.

The loads, not the tensor cores, set the time, so the next kernel has to load each number fewer times and with fewer instructions.

## Kernel 2

WIP.

## Results

All times are for M = N = K = 4096 with BF16 inputs and FP32 sums on the B200.

| Kernel | Time (ms) | TFLOPS | % of BF16 speed | % of cuBLAS |
|---|---|---|---|---|
| cuBLAS | 0.099 | 1,383 | 61.5% | 100% |
| 1, one warp for each 16 × 8 tile | 10.29 | 13.36 | 0.6% | 1.0% |
