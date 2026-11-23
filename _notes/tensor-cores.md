---
layout: notes
title: "Tensor cores and matrix multiplication"
description: "Matrix multiplication on the tensor cores of a B200, with BF16 inputs and FP32 sums: what a tensor core computes, the number formats that it reads, the mma instruction and its fragments, the first tensor core kernel, and a second one with shared memory, warp tiles and ldmatrix."
date: 2026-11-23
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
- [Number formats](#number-formats)
- [mma instruction](#mma-instruction)
- [Tensor core speed of the B200](#tensor-core-speed-of-the-b200)
- [cuBLAS reference](#cublas-reference)
- [Kernel 10: one warp for each 16 by 8 tile](#kernel-10-one-warp-for-each-16-by-8-tile)
- [Kernel 11: shared memory, warp tiles and ldmatrix](#kernel-11-shared-memory-warp-tiles-and-ldmatrix)
- [Results](#results)

</div>

## Tensor cores

### What limits the FP32 cores

In the [previous note]({{ '/notes/cuda-matmul.html' | relative_url }}), every multiply-add of a matrix multiplication was one `FFMA`, and each thread did its own. Kernel 9 kept the FP32 cores busy most of the time, so a faster matrix multiplication needs more math per tick. Adding more FP32 cores would not get there cheaply, because each `FFMA` costs much more than its multiply-add:

- The scheduler of each quarter runs one instruction per tick, so the 32 FP32 cores of a quarter do at most 32 multiply-adds per tick. More FP32 cores would also need more schedulers.
- Each `FFMA` reads 3 numbers from the registers and writes 1 back, for a single multiply-add. More FP32 cores would also need registers that move more numbers per tick.
- Fetching and decoding an instruction and reading its registers takes far more energy than the multiply-add itself.{% include components/sidenote.html id="sn-overhead" label="1" text="Bill Dally of NVIDIA [estimated](https://www.hc2023.hotchips.org/assets/program/conference/day2/Keynote%202/Keynote-NVIDIA_Hardware-for-Deep-Learning.pdf) that a 16-bit multiply-add takes about 1.5 pJ, while fetching and decoding its instruction and reading its registers take about 30 pJ. A single multiply-add instruction therefore spends about 95% of its energy outside the multiplier. One tensor core instruction of the V100 does many multiply-adds for about the same 30 pJ, so the instruction and its registers take only about a fifth of its energy. The figures are rough, and they are for an older chip process." %} The chip has a [power limit]({{ '/notes/gpu.html#math-speed' | relative_url }}), so the energy of each multiply-add limits the speed as much as the number of math units does.

### A math unit for small matrix products

In a matrix multiplication, each number is used many times, and a thread can keep a number in a register and use it in several `FFMA`s. Each of those `FFMA`s still reads the number from the register again, and each multiply-add is still a separate instruction.

A tensor core multiplies two small matrices in one instruction. It reads each input number from the registers once and passes it to many multipliers inside the unit. In a product of a 16 by 16 matrix and a 16 by 8 matrix, for example, each number of the first matrix takes part in 8 multiply-adds, and each number of the second in 16. One instruction then does 2,048 multiply-adds, so the cost of fetching the instruction and reading the registers is shared among all of them.

### Tensor cores of the B200

NVIDIA added tensor cores with the V100 in 2017, for training neural networks. With BF16 inputs, the tensor cores of the B200 reach 2,250 TFLOPS, about 30 times the speed of its FP32 cores.

Each SM of the B200 has 4 tensor cores, one for each quarter of the SM, next to its FP32 cores. A tensor core instruction works on matrices spread over a warp:

- The 32 threads of a warp issue the instruction together, and the tensor core computes one small matrix product for the whole warp.
- No thread holds a whole matrix. Each thread holds a few numbers of each matrix in its registers, and the instruction reads the registers of all 32 threads at once.
- The inputs are narrower than FP32, BF16 in this note, and the products are added in FP32.

## Number formats

### Sign, exponent and mantissa

A floating point number is a number in scientific notation, written in base 2. For example, 6 is 1.5 × 2², and −0.375 is −1.5 × 2⁻². Each number has three parts, and the format keeps each part in its own bits:

- The sign bit says whether the number is positive or negative.
- The exponent says which power of 2 the number sits at, e.g., 2² for 6. More exponent bits reach larger and smaller powers, so they set the range of the format.
- The mantissa says where the number sits between its power of 2 and the next one, e.g., 1.5 for 6, which is halfway between 4 and 8. More mantissa bits split each power of 2 into finer steps, so they set the precision.

A format with a fixed number of bits chooses how many of them go to the exponent and how many to the mantissa, so it trades range against precision.

### From bits to a number

A format with E exponent bits and M mantissa bits turns its bits into a number in three steps:

1. The sign bit `s` gives (−1)<sup>s</sup>, so 0 means positive and 1 means negative.
2. The exponent bits are read as a whole number `e` from 0 to 2<sup>E</sup> − 1. The format subtracts a fixed bias of 2<sup>E−1</sup> − 1, so that the power 2<sup>e − bias</sup> can be negative as well as positive. FP32, for example, has 8 exponent bits and a bias of 127.
3. The mantissa bits `m` are the binary digits after the point in 1.m. Every number other than 0 starts with a 1 in binary, so the format doesn't store the 1, and all M bits go to the digits after it.

The number is then (−1)<sup>s</sup> × 1.m × 2<sup>e − bias</sup>. Two exponent patterns follow other rules:

- When all exponent bits are 0, `e` is 0, but the format changes two things. The leading 1 becomes a 0, and the power is 2<sup>1 − bias</sup> instead of 2<sup>0 − bias</sup>, which is the same power as for `e` = 1. The number is then (−1)<sup>s</sup> × 0.m × 2<sup>1 − bias</sup>. With the leading 0, the format can hold 0, which it can't when every number starts with a 1. With the power of `e` = 1, the numbers between 0 and the smallest power have the same gap as the numbers just above it, and they are called subnormal numbers.
- FP32, FP16 and BF16 keep the all-ones pattern for infinity and for NaN ("not a number"), the result of e.g. 0 / 0. The narrow formats can't spare a whole exponent, so E2M1 uses it for ordinary numbers, and E4M3 keeps only its pattern with all mantissa bits 1 for NaN.

### Example: E2M1

E2M1 is the 4-bit format behind FP4. It has 1 sign bit, 2 exponent bits and 1 mantissa bit, so its bias is 2¹ − 1 = 1, and its mantissa is either 1.0 or 1.1 in binary, which is 1.5. Here are its 8 positive patterns:

| Exponent bits | `e` | Mantissa bit | Number |
|---|---|---|---|
| 00 | 0 | 0 | 0.0 × 2⁰ = 0 |
| 00 | 0 | 1 | 0.5 × 2⁰ = 0.5 |
| 01 | 1 | 0 | 1.0 × 2⁰ = 1 |
| 01 | 1 | 1 | 1.5 × 2⁰ = 1.5 |
| 10 | 2 | 0 | 1.0 × 2¹ = 2 |
| 10 | 2 | 1 | 1.5 × 2¹ = 3 |
| 11 | 3 | 0 | 1.0 × 2² = 4 |
| 11 | 3 | 1 | 1.5 × 2² = 6 |

With the sign bit, the same 8 patterns also give the negative numbers. +0 and −0 are the same number, so E2M1 has 15 different values, from −6 to 6.

### Formats in use

A narrower number takes less memory and less bandwidth, and the tensor core can multiply more of them per tick. On the B200, each halving of the width doubles the listed speed of the tensor cores, from 2,250 TFLOPS with 16-bit inputs to 9,000 TFLOPS with 4-bit inputs.

| Format | Exponent bits | Mantissa bits | Bits in all | Largest number |
|---|---|---|---|---|
| FP32 | 8 | 23 | 32 | just under 2¹²⁸ |
| TF32 | 8 | 10 | 19 of 32 | just under 2¹²⁸ |
| FP16 | 5 | 10 | 16 | just under 2¹⁶ |
| BF16 | 8 | 7 | 16 | just under 2¹²⁸ |
| FP8 E4M3 | 4 | 3 | 8 | 448 |
| FP8 E5M2 | 5 | 2 | 8 | just under 2¹⁶ |
| FP4 E2M1 | 2 | 1 | 4 | 6 |

The V100 used FP16. Its 5 exponent bits give a bias of 15, and the largest power is 2¹⁵, because the all-ones exponent is kept for infinity. Its largest number, 1.1111111111 × 2¹⁵ in binary, is therefore 65,504, just under 2¹⁶. Its smallest number is the subnormal 0.0000000001 × 2⁻¹⁴, which is 2⁻²⁴. The gradients in training are often smaller than that, so training in FP16 needed loss scaling, where the program multiplies the loss by a large factor and divides the gradients by it again later.

BF16, which came with the A100, splits the 16 bits the other way. It keeps the 8 exponent bits of FP32, so it covers the same range, and it gives up mantissa bits instead. Training in BF16 needs no loss scaling, and BF16 is now the usual 16-bit format for training. TF32 is a way to run an FP32 matrix multiplication on the tensor cores, which keep only the first 10 of the 23 mantissa bits of each number.

With 8 bits, no single split gives enough range and enough precision, so FP8 comes in two splits. E4M3 has more precision for weights and activations, and E5M2 has more range for gradients. Neither covers the range of all the numbers in a layer, so the program stores a scale with them. It divides the numbers by the scale before it rounds them to FP8, so that the largest one lands near the top of the range, and it multiplies the results by the scale again.

FP4 has only 15 values, so one scale for a whole matrix is too coarse. FP4 numbers therefore share a scale in small blocks. Suppose the largest number in a block is 0.03. The program divides the whole block by 0.005, so that 0.03 becomes 6, the largest E2M1 number, and the other numbers of the block spread over the 15 values. Two block formats are in use:

- MXFP4, from the Open Compute Project, gives each block of 32 numbers an 8-bit scale that is a power of 2.
- NVFP4, from NVIDIA, gives each block of 16 numbers an FP8 E4M3 scale, plus one FP32 scale for the whole matrix. The smaller blocks and the finer scales round the numbers more closely, for about a quarter of a bit more per number.{% include components/sidenote.html id="sn-nvfp4" label="2" text="The E4M3 block scales reach only from about 2⁻⁹ to 448, so the FP32 scale first moves the whole matrix into the range that the block scales can cover. NVIDIA's [introduction to NVFP4](https://developer.nvidia.com/blog/introducing-nvfp4-for-efficient-and-accurate-low-precision-inference/) explains both scales and compares NVFP4 with MXFP4." %}

The tensor cores of the B200 read the block scales themselves and apply them during the matrix product.

### BF16 in this note

The kernels in this note use BF16 inputs and FP32 sums:

- BF16 covers the same range of numbers as FP32, because it has the same exponent, but it keeps only about 2 to 3 significant decimal digits. Rounding a number to BF16 changes it by up to 0.4%.
- A BF16 number is the upper half of the FP32 number that it rounds, so converting between the two is cheap.
- The tensor core adds the products in FP32, so the only extra rounding happens once, on the inputs.

The programs in this note round `A` and `B` to BF16 once on the CPU. The spot check compares 100 elements of `C` with an FP64 sum of the same rounded numbers, so it measures only the error of the sums.

## mma instruction

`mma.sync` is the warp-level matrix multiply-add of PTX, and its full name says what it computes:

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

The 2,250 TFLOPS for BF16 inputs is NVIDIA's listed figure, against 74.45 TFLOPS for the FP32 cores.{% include components/sidenote.html id="sn-sparse" label="3" text="NVIDIA also lists 4,500 TFLOPS, but only for 2:4 sparsity, where 2 of every 4 numbers of one input are zero and the tensor core skips them. A dense matrix multiplication can reach at most the 2,250." %} The CUDA runtime has no value to compute this speed from, so the programs use the listed figure.

- The ridge point moves from 9.7 FLOPs per byte for the FP32 cores to 2,250 TFLOPS ÷ 7,672 GB per second = 293 FLOPs per byte. A kernel has to use each number that it loads from HBM many more times to keep the tensor cores busy.
- At M = N = K = 4096, the 137 billion operations take at least 0.061 ms. Reading `A` and `B` from HBM once and writing `C` once takes about 0.017 ms. With the FP32 cores, the math took 70 times longer than the reads, and with the tensor cores it takes only about 3.5 times longer.

## cuBLAS reference

cuBLAS multiplies BF16 matrices with FP32 sums through `cublasGemmEx`:

```cpp
// row-major C = A * B is column-major C^T = B^T * A^T, so B goes first
cublasGemmEx(handle, CUBLAS_OP_N, CUBLAS_OP_N, N, M, K, &alpha,
             d_B, CUDA_R_16BF, N, d_A, CUDA_R_16BF, K, &beta,
             d_C, CUDA_R_32F, N, CUBLAS_COMPUTE_32F, CUBLAS_GEMM_DEFAULT);
```

It took 0.099 ms, which is 1,383 TFLOPS and 61.5% of the listed BF16 speed, and 22 times faster than cuBLAS with FP32 numbers on the FP32 cores. Nsight Compute shows its tensor cores busy about three quarters of the kernel's time. At this size, one product takes only a tenth of a millisecond, and separate runs differed by about 2%.{% include components/sidenote.html id="sn-emulation" label="4" text="cuBLAS can also run the FP32 matrix multiplication of the previous note on the tensor cores. With the environment variable CUBLAS_EMULATE_SINGLE_PRECISION=1, it splits each FP32 number into 3 BF16 numbers and adds up 9 tensor core products. It took 0.84 ms instead of 2.16 ms, and the largest error in the spot check was 6.9e-7, smaller than the 2.7e-6 of cublasSgemm on the FP32 cores." %}

## Kernel 10: one warp for each 16 by 8 tile

The simplest tensor core kernel gives each 16 by 8 tile of `C` its own warp, as kernel 1 of the previous note gave each element its own thread. The warp walks along its 16 rows of `A` and its 8 columns of `B`, 16 values of `k` at a time. At each step, each lane loads its 8 numbers of `A` and 4 numbers of `B` from global memory, packs them in pairs into registers, and the warp issues one `mma`. The 4 sums of each lane stay in registers until the end.

[![Kernel 10: one warp computes one 16 by 8 tile of C. At each step it loads a 16 by 16 piece of its 16 rows of A and a 16 by 8 piece of its 8 columns of B, and the steps move along k]({{ '/assets/images/tc-kernel10.svg' | relative_url }}){: .ia-gpu-overview}]({{ '/assets/images/tc-kernel10.svg' | relative_url }})

Here is the work of one warp. `{x, y}` stands for `pack_bf16(x, y)`, and `A[r][c]` stands for `A[r * K + c]`:

```cpp
// Compute one 16 x 8 tile of C, starting at (row, col), with one warp

// Registers for the tile: each lane keeps 4 of its 128 numbers
float c[4] = {};

// The fragment layout: group = lane / 4 picks this lane's rows, t = lane % 4 its columns
int group = lane / 4, t = lane % 4;

// Iterate over 16-wide chunks of k
for (int k0 = 0; k0 < K; k0 += 16) {
    int k = k0 + 2 * t;

    // Load this lane's 8 numbers of A's chunk [16, 16] straight from global memory,
    // two neighbors along k in each 32-bit register
    a[0] = {A[row + group][k],         A[row + group][k + 1]};
    a[1] = {A[row + group + 8][k],     A[row + group + 8][k + 1]};
    a[2] = {A[row + group][k + 8],     A[row + group][k + 9]};
    a[3] = {A[row + group + 8][k + 8], A[row + group + 8][k + 9]};

    // Load this lane's 4 numbers of B's chunk [16, 8]
    b[0] = {B[k][col + group],     B[k + 1][col + group]};
    b[1] = {B[k + 8][col + group], B[k + 9][col + group]};

    // mma for [16, 16] x [16, 8]: all 32 lanes run it together, c += a * b
    mma(c, a, b);
}
// ... write the 4 numbers of c to C ...
```

Each block has 2 warps, and the grid has one warp for each 16 by 8 tile of `C`.

<details markdown="1">
<summary>SASS of the loop</summary>

Kernel 10 for the B200 (`-O3 -arch=sm_100`), from `cuobjdump -sass`, compiled with the bounds checks, which add the `ISETP` and `@!P` instructions. The 12 `LDG.E.U16` instructions each load 2 bytes, 8 for `A` and 4 for `B`. Each `PRMT` without a condition puts two of them into one 32-bit register, and each `@P PRMT` sets a number to zero when the bounds check turned its load off. `HMMA.16816.F32.BF16` is the `mma`.

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

Kernel 10 took 10.29 ms, which is 13.36 TFLOPS and 1.0% of cuBLAS. It is faster than kernel 3 of the previous note, which used shared memory, but slower than its kernel 4. I tried blocks of 1, 2, 4, 8 and 16 warps, and the times differed by less than 3%, with 2 warps fastest.

Kernel 10 is slow because its loads from global memory are not [coalesced]({{ '/notes/cuda-matmul.html#kernel-2-reading-neighboring-numbers' | relative_url }}). A load is coalesced when the 32 lanes of a warp read neighboring numbers, so the GPU can serve them with a few 32-byte sectors. The fragment layout of `mma` spreads the lanes the other way. In one load of `A`, the 32 lanes read from 8 different rows, with only 4 lanes in each row, and each lane reads one 2-byte number. The GPU fetches a whole sector for each of the 8 rows, and the warp uses only a small part of each one. The loads of `B` are scattered over 4 rows in the same way, and each lane needs 12 of these small loads before the warp can issue one `mma`.

No warp shares its numbers with another warp either. All the warps in a row of tiles load the same rows of `A`, and all the warps in a column of tiles load the same columns of `B`. Nsight Compute shows the result. The L1 cache, which serves the loads, is busy almost all the time, as in kernel 1 of the previous note, and the tensor cores are busy only 2.4% of the time, because the warps spend most of their time waiting for their numbers from global memory.

## Kernel 11: shared memory, warp tiles and ldmatrix

Kernel 10 loads every number of its fragments from global memory, and no warp shares its numbers with another warp. The FP32 note solved the same problems, and its ideas work for the tensor cores too, so kernel 11 uses them together:

- Shared memory tiles, as in [kernel 3]({{ '/notes/cuda-matmul.html#kernel-3-shared-memory' | relative_url }}). Each block computes a 128 by 128 tile of `C`, and at each step its threads copy a 128 by 16 tile of `A` and a 16 by 128 tile of `B` into shared memory.
- Vectorized loads, as in [kernel 6]({{ '/notes/cuda-matmul.html#kernel-6-vectorized-loads' | relative_url }}). Each thread copies 8 neighboring numbers, which is 16 bytes, with one load instruction, so the copies are coalesced and take few instructions.
- Warp tiles, as in [kernel 9]({{ '/notes/cuda-matmul.html#kernel-9-warp-tiling' | relative_url }}). Each of the 8 warps of a block computes a 64 by 32 tile of `C`, which is 4 by 4 pieces of 16 by 8. Each fragment of `A` then goes into 4 `mma` instructions, and so does each fragment of `B`.

[![Kernel 11: one block computes a 128 by 128 tile of C with 8 warps, and each warp computes a 64 by 32 tile, which is 4 by 4 pieces of 16 by 8. At each step the block copies a 128 by 16 tile of A and a 16 by 128 tile of B into shared memory as s_A and s_B, and the steps move along k]({{ '/assets/images/tc-kernel11.svg' | relative_url }}){: .ia-gpu-overview}]({{ '/assets/images/tc-kernel11.svg' | relative_url }})

The one new idea is how a warp loads its fragments from shared memory.

### ldmatrix

Loading the fragments one 2-byte number at a time would take 12 load instructions for each `mma`. The numbers that a warp needs sit together in a few small squares, though. The `A` fragment is a 16 by 16 square of `s_A`, which is four 8 by 8 squares, and the `B` fragment is two 8 by 8 squares of `s_B`. PTX has an instruction for these loads. `ldmatrix` loads up to four 8 by 8 squares of 2-byte numbers from shared memory in one instruction, and it hands each lane its numbers in the fragment layout of `mma`.

Each row of an 8 by 8 square is 8 numbers, or 16 bytes, side by side in shared memory, so the addresses of its 8 rows describe the whole square. Lanes 0 to 7 give the row addresses of the first square, lanes 8 to 15 give those of the second, and so on. The hardware reads each row of 16 bytes in one piece and spreads it over 4 lanes, so that lane `4 × group + t` gets numbers `2t` and `2t + 1` of row `group` in one 32-bit register. Each 8 by 8 tile of the `A` fragment has this same layout, so the 4 registers that come back from the `.x4` version are `a[0]` to `a[3]`.

The `B` fragment needs pairs along `k`, and in `s_B` those pairs sit in one column, because each row of `s_B` holds a row of `B`. The `.trans` version of `ldmatrix` transposes each square as it loads it, so lane `4 × group + t` gets numbers `2t` and `2t + 1` of column `group` instead. One `.x4.trans` loads the `B` fragments of two neighboring pieces. Lanes 0 to 15 give the 16 rows of `s_B` at the first 8 columns, and lanes 16 to 31 give the same rows at the next 8 columns.

In inline PTX, `ldmatrix` takes the shared memory address that this lane gives, and it fills 4 registers:

{% raw %}
```cpp
// four 8 x 8 squares; lanes 0-7, 8-15, 16-23 and 24-31 give the row addresses of squares 0, 1, 2 and 3
__device__ void ldmatrix_x4(uint32_t r[4], const __nv_bfloat16* row) {
    uint32_t addr = __cvta_generic_to_shared(row);   // ldmatrix takes a shared memory address
    asm volatile("ldmatrix.sync.aligned.m8n8.x4.shared.b16 {%0, %1, %2, %3}, [%4];"
                 : "=r"(r[0]), "=r"(r[1]), "=r"(r[2]), "=r"(r[3])
                 : "r"(addr));
}
// ldmatrix_x4_trans is the same with .x4.trans
```
{% endraw %}

Here is the work of one block:

```cpp
// Compute a 128 x 128 tile of C with 8 warps; each warp computes a 64 x 32 piece of it
__shared__ bf16 s_A[128][16], s_B[16][128];

// Registers for the warp's piece: 4 x 4 mma tiles of 16 x 8, with 4 numbers of each in this lane
float c[4][4][4] = {};

// Iterate over 16-wide chunks of k
for (int k0 = 0; k0 < K; k0 += 16) {
    // ... load A's chunk [128, 16] into s_A, 16 bytes per thread ...
    // ... load B's chunk [16, 128] into s_B, 16 bytes per thread ...
    __syncthreads();

    // ldmatrix: each lane gives the address of one row of an 8 x 8 square,
    // and every lane gets back its numbers in the fragment layout of mma.
    // Lanes 0 to 15 give 16 rows, and lanes 16 to 31 the same rows 8 columns to the right
    for (int m = 0; m < 4; m++)     // A: one fragment for each 16 rows of the warp's piece
        ldmatrix_x4(a[m], &s_A[warp_row + 16 * m + lane % 16][8 * (lane / 16)]);
    for (int n = 0; n < 4; n += 2)  // B: transposed, two fragments of 8 columns per load
        ldmatrix_x4_trans({b[n], b[n + 1]}, &s_B[lane % 16][warp_col + 8 * n + 8 * (lane / 16)]);

    // 16 mma: each fragment of A meets each fragment of B
    for (int m = 0; m < 4; m++)
        for (int n = 0; n < 4; n++)
            mma(c[m][n], a[m], b[n]);

    // Every warp is done with s_A and s_B before the next chunk overwrites them
    __syncthreads();
}
// ... write registers c to C ...
```

Each block has 8 warps, and the grid has one block for each 128 by 128 tile of `C`.

<details markdown="1">
<summary>SASS of one step of the loop</summary>

Kernel 11 for the B200 (`-O3 -arch=sm_100`), from `cuobjdump -sass`, with the address and bounds check instructions left out. The two `LDG.E.128` load this thread's 16 bytes of each tile, and the two `STS.128` store them into shared memory. The 4 `LDSM.16.M88.4` load the 4 fragments of `A`, and the 2 `LDSM.16.MT88.4` load the 4 fragments of `B`. The 16 `HMMA` instructions then use those registers, and `.reuse` lets the next `HMMA` take the same fragment of `A` without reading its registers again.

```
LDG.E.128 R68, desc[UR8][R68.64]
@P1 LDG.E.128 R72, desc[UR8][R72.64]
STS.128 [R79], R68
STS.128 [R78], R72
BAR.SYNC.DEFER_BLOCKING 0x0
LDSM.16.M88.4 R76, [R2]
LDSM.16.MT88.4 R72, [R3]
LDSM.16.MT88.4 R68, [R3+0x20]
LDSM.16.M88.4 R80, [R2+0x200]
HMMA.16816.F32.BF16 R52, R76.reuse, R72, R52
HMMA.16816.F32.BF16 R48, R76.reuse, R74, R48
HMMA.16816.F32.BF16 R44, R76.reuse, R68, R44
HMMA.16816.F32.BF16 R40, R76, R70, R40
LDSM.16.M88.4 R76, [R2+0x400]
HMMA.16816.F32.BF16 R36, R80.reuse, R72, R36
HMMA.16816.F32.BF16 R32, R80.reuse, R74, R32
HMMA.16816.F32.BF16 R28, R80.reuse, R68, R28
HMMA.16816.F32.BF16 R24, R80, R70, R24
LDSM.16.M88.4 R80, [R2+0x600]
HMMA.16816.F32.BF16 R12, R76.reuse, R72, R12
HMMA.16816.F32.BF16 R8, R76.reuse, R74, R8
HMMA.16816.F32.BF16 R4, R76.reuse, R68, R4
HMMA.16816.F32.BF16 R20, R76, R70, R20
HMMA.16816.F32.BF16 R16, R80.reuse, R72, R16
HMMA.16816.F32.BF16 R56, R80.reuse, R74, R56
HMMA.16816.F32.BF16 R60, R80.reuse, R68, R60
HMMA.16816.F32.BF16 R64, R80, R70, R64
BAR.SYNC.DEFER_BLOCKING 0x0
```

</details>

Kernel 11 took 1.30 ms, which is 105 TFLOPS and 7.9 times faster than kernel 10. I tried 6 tile sizes, and the 128 by 128 tile with 16 along `k` and warp tiles of 64 by 32 was fastest. The next best took 1.64 ms.

Kernel 11 is still slow because `ldmatrix` has bank conflicts. `ldmatrix` reads the 8 rows of a square in one pass only when the rows sit in different [banks]({{ '/notes/cuda-matmul.html#shared-memory-banks' | relative_url }}). Rows of `s_A` are 32 bytes apart, so rows 4 apart use the same banks, and each square of `A` takes 2 passes. Rows of `s_B` are 256 bytes apart, two full turns of the banks, so all 8 rows of a square use the same banks, and each square of `B` takes 8 passes. Nsight Compute shows the tensor cores busy only a fifth of the time, and close to half of the time that a warp waits goes to waiting for the results of `ldmatrix`.

## Results

All times are for M = N = K = 4096 with BF16 inputs and FP32 sums on the B200.

| Kernel | Time (ms) | TFLOPS | % of BF16 speed | % of cuBLAS |
|---|---|---|---|---|
| cuBLAS | 0.099 | 1,383 | 61.5% | 100% |
| 10, one warp for each 16 × 8 tile | 10.29 | 13.36 | 0.6% | 1.0% |
| 11, shared memory, warp tiles and ldmatrix | 1.30 | 105.4 | 4.7% | 7.6% |
