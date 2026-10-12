---
layout: notes
title: "RoPE"
date: 2026-10-12
tags: ["llm", "rope", "position"]
project: llm-from-scratch
part: 2
published: true
---

RoPE (rotary position embedding) tells a model where each token is in the text. It turns the numbers of each token by an angle that depends on the position of the token.

## Contents

<div class="ia-toc" markdown="1">

- [Why a model needs positions](#why-a-model-needs-positions)
- [How RoPE turns a pair of numbers](#how-rope-turns-a-pair-of-numbers)
- [The score depends on the distance](#the-score-depends-on-the-distance)
- [A different speed for each pair](#a-different-speed-for-each-pair)
- [Why the pairs need different speeds](#why-the-pairs-need-different-speeds)
- [The score falls with distance](#the-score-falls-with-distance)

</div>

## Why a model needs positions

A model stores each token as a list of numbers called a vector, and a token starts with the same vector at any place in the text. For example, the two texts in the table have the same three vectors, but they have different meanings.

| Text | Vectors |
|---|---|
| `dog bites man` | `dog`, `bites`, `man` |
| `man bites dog` | `man`, `bites`, `dog` |

The model therefore needs the position of each token in addition to its vector. RoPE gives the position by turning the vector, and a token that is later in the text gets a larger turn. The method is from the paper [RoFormer: Enhanced Transformer with Rotary Position Embedding](https://arxiv.org/abs/2104.09864).

## How RoPE turns a pair of numbers

RoPE works on two numbers of a vector at a time. The two numbers are the coordinates of a point, and the diagram shows the point as an arrow from the center. RoPE turns the arrow by `position × θ`, where `θ` is a fixed angle. In the diagram `θ` is 30°, and you can select a word to see its turn.

{% include components/rope-rotate.html step="30" %}

A turn changes the direction of an arrow, and it doesn't change the length. For example, the word `the` is at positions 0 and 4. Both start with the same arrow and finish with different arrows, so the model can tell them apart.

For a token at position $m$, RoPE changes a pair $(x_1, x_2)$ with the following calculation.

$$
\begin{aligned}
x_1' &= x_1 \cos(m\theta) - x_2 \sin(m\theta) \\
x_2' &= x_1 \sin(m\theta) + x_2 \cos(m\theta)
\end{aligned}
$$

## The score depends on the distance

To compare two tokens, the model calculates a score from their arrows. The score is high when the two arrows point in the same direction, and it is negative when they point in opposite directions. The score is 0 when the arrows are at a right angle.

The diagram shows the arrows of `cat` and `mat` after their turns, with a `θ` of 20°. You can change the distance between the words, and you can move both words together.

{% include components/rope-relative.html step="20" %}

When both words move by the same number of positions, both arrows get the same extra turn. The angle between the arrows doesn't change, so the score doesn't change.

$$
\text{angle between the arrows} = \text{angle at the start} + (\text{distance} \times \theta)
$$

The score therefore depends on the distance between two tokens, and it doesn't depend on where the tokens are in the text. For example, two words that are next to each other get the same score at the start of a text and 1,000 tokens later.

## A different speed for each pair

Each pair of a vector turns at its own speed. The table gives the meaning of the two words that the explanation uses.

| Word | Meaning |
|---|---|
| Position | The place of a token in the text. The first token is at position 0. |
| Pair | Two numbers that are next to each other in the vector of one token. A vector of $d$ numbers has $d/2$ pairs. |

The speed of a pair is its angle `θ`, which is the amount that the pair turns when the position increases by 1. A pair with a large `θ` turns fast, and a pair with a small `θ` turns slowly.

$$
\theta_k = 10000^{-2(k-1)/d} \qquad k = 1, 2, \ldots, d/2
$$

The formula gives the angle of pair $k$ in radians, and 1 radian is approximately 57°. Pair 1 turns the fastest, and each later pair turns more slowly.

The diagram shows one token that has a vector of 8 numbers, so it has 4 pairs. Each circle shows the turn of one pair at the selected position, and the dashed line shows its turn at the next position.

{% include components/rope-clocks.html dim="8" position="7" %}

A fast pair turns by a large angle from one position to the next, so it separates positions that are near each other. A slow pair turns by a small angle, so it separates positions that are far apart.

## Why the pairs need different speeds

One pair can't give a different score to each distance. The graph puts the same vector at two positions and shows the score between the two copies, for each distance from 0 to 100. The vector has 64 numbers, so it has 32 pairs. The score of the vector is the average of the scores of its pairs.

{% include components/rope-curve.html dim="64" distance="6" %}

First, the score of pair 1 repeats approximately every 6 positions, so a distance of 6 gets almost the same score as a distance of 0. Second, the score of pair 9 changes slowly, so a distance of 1 gets almost the same score as a distance of 0. Third, the average score of all 32 pairs is 1 only at a distance of 0. It falls quickly for near distances, and it doesn't return to 1.

## The score falls with distance

The score between two positions becomes smaller when the positions are farther apart. The graph puts one vector at position A and a copy of it at each other position. The line shows the score between position A and each position, and you can select position B on the line to see the score between the two positions.

{% include components/rope-between.html dim="64" a="20" b="45" %}

The line is highest at position A, where the distance is 0, and it falls on both sides. When position A changes, the line moves with it and keeps its shape, because the score depends only on the distance.

The score falls because fewer pairs have a score near 1 at a larger distance. A pair has a score near 1 only when `distance × θ` is a small angle, which is true for fewer pairs when the distance is larger. The scores of the other pairs are spread between -1 and 1, so they add up to approximately 0. The fall isn't smooth, and the line has small rises and falls.

The graph shows only the effect of the turns on two copies of one vector. In a model, the two vectors are different, so the scores are different and a token that is far away can still get a high score.
