---
layout: notes
title: "Transformer language model"
date: 2026-10-17
tags: ["llm", "transformer", "attention"]
project: llm-from-scratch
part: 3
published: true
extra_css:
  - /assets/css/transformer.css
---

A language model reads a list of tokens and gives a probability for each possible next token. The sections below follow one sentence through a transformer language model, from the token ids to the model's guess for the next token.

The transformer comes from the paper [Attention Is All You Need](https://arxiv.org/abs/1706.03762) (Vaswani and others, 2017). The model here is a decoder-only transformer, the same kind as GPT, so it reads the tokens in order and guesses the next one. It also has changes from later papers, and each section names the paper that its idea comes from.

The sentence is `the cat saw the hat` from the [BPE note](/notes/bpe-tokenizer.html). The tokenizer splits it into five tokens: `the`, `␣cat`, `␣saw`, `␣the` and `␣hat`. The symbol `␣` shows a space.

{% include components/tf.html diagram="explorer" %}

In the view, each token is a colored lane that goes from left to right through the model. The view shows one layer, and a real model repeats the layer N times.

## Contents

<div class="ia-toc" markdown="1">

- [The path through the model](#the-path-through-the-model)
- [From text to vectors](#from-text-to-vectors)
- [The residual stream](#the-residual-stream)
- [RMSNorm](#rmsnorm)
- [Attention](#attention)
- [Positions with RoPE](#positions-with-rope)
- [The feed-forward layer](#the-feed-forward-layer)
- [From vectors to the next token](#from-vectors-to-the-next-token)
- [Counting weights, FLOPs and memory](#counting-weights-flops-and-memory)

</div>

## The path through the model

The table lists the steps of the model in order.

| Step | What it does |
|---|---|
| Embedding | Changes each token id into a vector of numbers. |
| Layers | Each layer changes the vectors a little. A model has many layers, one after the other. |
| Final RMSNorm | Gives all the vectors the same norm. |
| LM head | Changes each vector into one score for each token of the vocabulary. |
| Softmax | Changes the scores into probabilities. |

Each layer has two parts. First, attention lets each token take in information from the tokens before it. Second, a feed-forward layer works on each token alone.

The diagrams in the note use small, made-up numbers that show the shape of each calculation. A real model learns its numbers from data, and it has many more of them.

## From text to vectors

The model changes each token id into a vector, which is a list of numbers, because it can't do useful calculations with the id itself. The size of an id has no meaning, e.g., id 3797 isn't "larger" than id 262 in any useful way.

The embedding table has one row for each token of the vocabulary, so a vocabulary of 10,000 tokens gives a table with 10,000 rows. Each row is a vector of `d_model` numbers, and the vector of a token is the row at its id.

{% include components/tf.html diagram="embed" %}

The tokens `the` and `␣the` have different ids, so they get different vectors. A token that occurs two times in a text gets the same vector both times, because at the embedding step the vector doesn't contain the position of the token.

The idea of a learned vector for each word comes from [A Neural Probabilistic Language Model](https://www.jmlr.org/papers/volume3/bengio03a/bengio03a.pdf) (Bengio and others, 2003). Bengio and others also used the vectors to predict the next word, which is the same task as here. Later, [word2vec](https://arxiv.org/abs/1301.3781) (Mikolov and others, 2013) made word vectors fast to learn from a large amount of text.

## The residual stream

The residual stream is the vector of a token as it goes through the layers. Each part of a layer reads the stream and calculates a change, and then the model adds the change to the stream.

For a vector $x$, one layer does two additions:

$$
\begin{aligned}
h &= x + \text{Attention}(\text{RMSNorm}(x)) \\
y &= h + \text{FFN}(\text{RMSNorm}(h))
\end{aligned}
$$

Because each part only adds to the stream, the information from earlier parts stays in the vector.{% include components/sidenote.html id="sn-sum" label="1" text="Without the addition, the signal must pass through every layer in turn, and each layer scales it, so over many layers the signal and its gradient can shrink to almost 0 or grow very large. In the ResNet paper, a deeper network without the addition trained worse than a shallower one. With $x + f(x)$, the derivative is $I + f'(x)$, so the gradient always has a direct path back to the first layer that doesn't pass through the other layers." %} In the 3D view at the top, each lane goes up on a branch through a part, and it comes back down where the model adds the change.

The addition is called a residual connection. It comes from [Deep Residual Learning for Image Recognition](https://arxiv.org/abs/1512.03385) (He and others, 2015), where it let networks train with many more layers. The original transformer put the normalization after each addition, and [GPT-2](https://cdn.openai.com/better-language-models/language_models_are_unsupervised_multitask_learners.pdf) (Radford and others, 2019) moved it to the start of each part, as in the formulas above.

## RMSNorm

RMSNorm gives every vector the same norm before a part reads it. The norm of a vector is one number that tells how large its numbers are. (Every vector has the same count of numbers, `d_model`.)

The vectors need the same norm for two reasons. First, the tokens have different norms from the start, because each row of the embedding table is learned on its own. Second, the numbers in the stream can become very large or very small after many additions. RMSNorm divides a vector by its RMS (root mean square), which makes the norms equal.{% include components/sidenote.html id="sn-prenorm" label="2" text="The original transformer normalized the stream after each addition, so the direct path from note 1 went through a norm in every layer, and deep models of that kind need a slow warm-up of the learning rate before they train well. Here the model normalizes only the copy that a part reads, and the stream path has no norm on it." %}

$$
\text{RMS}(x) = \sqrt{\frac{1}{d}\sum_{i=1}^{d} x_i^2 + \varepsilon}
\qquad
\text{RMSNorm}(x)_i = \frac{x_i}{\text{RMS}(x)} \, g_i
$$

The small number $\varepsilon$ stops a division by zero. The weights $g_i$ let the model make some numbers larger than others, and the diagram leaves them out.

{% include components/tf.html diagram="rmsnorm" %}

When you multiply the input by a positive number, the output doesn't change, because RMSNorm keeps the relation between the numbers of a vector and changes only its norm.

RMSNorm comes from [Root Mean Square Layer Normalization](https://arxiv.org/abs/1910.07467) (Zhang and Sennrich, 2019). It is a simpler version of [layer normalization](https://arxiv.org/abs/1607.06450) (Ba and others, 2016), which the original transformer used. Layer normalization also subtracts the average of the numbers, and RMSNorm leaves out that step.

## Attention

Attention is the only part of the model where a token gets information from other tokens. For example, the token `␣hat` can take in some information from `␣cat`.

Attention first came from machine translation, in [Neural Machine Translation by Jointly Learning to Align and Translate](https://arxiv.org/abs/1409.0473) (Bahdanau and others, 2014). When their model wrote each word of a translation, it looked back at each word of the input sentence and gave it a weight. The transformer made attention the main part of the model.

Each token makes three vectors from its stream vector:

| Vector | Question it answers |
|---|---|
| Query | What does the token look for? |
| Key | What does the token contain? |
| Value | What information does the token give? |

The score of token A for token B is the dot product of the query of A and the key of B, divided by $\sqrt{d_k}$, where $d_k$ is the length of a key. A high score means that B has what A looks for. The division keeps the scores in a steady range.{% include components/sidenote.html id="sn-scale" label="3" text="If the numbers of $q$ and $k$ are independent, with mean 0 and variance 1, then $q \cdot k$ has variance $d_k$, so its typical size grows as $\sqrt{d_k}$. The division brings the typical size back to about 1 for any head size. Without the division, the scores are large and softmax is almost one-hot, so its gradient is almost 0 and the attention stops learning." %} The division comes from the transformer paper.

$$
\text{Attention}(Q, K, V) = \text{softmax}\!\left(\frac{QK^\top}{\sqrt{d_k}}\right) V
$$

A token must not look at the tokens after it, because the model must guess the later tokens.{% include components/sidenote.html id="sn-parallel" label="4" text="The mask also makes training fast. A model that reads the text one token at a time must wait for each step. With the mask, each position sees only the tokens before it, so one pass over $T$ tokens gives $T$ next-token guesses at the same time, and no guess can see the token that it must guess." %} The causal mask removes the scores for later tokens before the softmax. Softmax then changes each row of scores into weights that are 0 or more and that add up to 1.

The diagram shows the four steps of attention for four heads.

{% include components/tf.html diagram="attention" %}

A model has many heads in each layer, and each head has its own queries, keys and values, so each head can look for a different kind of information.{% include components/sidenote.html id="sn-heads" label="5" text="A softmax gives one weighted average, so one head that needs information from two different tokens must split its weight between them and gets a mix of both. With $h$ heads of size $d/h$, a token can take one kind of information from one token and another kind from a different token. The $h$ heads together have the same number of weights as one head of size $d$, so the extra heads cost almost nothing." %} The model joins the outputs of all the heads, and one more matrix mixes them into one vector for each token. The transformer paper calls the heads multi-head attention.

The four heads in the diagram show patterns that trained models often have, e.g., one head looks at the token before, and one head looks at the first token.{% include components/sidenote.html id="sn-sink" label="6" text="The weights of each row must add up to 1, so a head must put its weight somewhere, even when no token has what it looks for. Trained models often put that weight on the first token, which every token can see. Such tokens are called attention sinks, and a model gets much worse when the first tokens are taken out of its view." %} The numbers in the diagram are made up.

## Positions with RoPE

Attention by itself doesn't use the order of the tokens. A token gets a weighted average of the value vectors, and a weighted average gives the same result for any order of its inputs. For example, in the first layer, the final `.` of `dog bites man .` and of `man bites dog .` sees the same keys and values in a different order, so it gets the same output.

RoPE gives attention the positions of the tokens. It turns each query and each key by an angle that depends on the position of its token, so the score depends on the distance between the two tokens. RoPE comes from [RoFormer](https://arxiv.org/abs/2104.09864) (Su and others, 2021), and the [RoPE note](/notes/rope.html) explains it in detail, with its own diagrams.

## The feed-forward layer

The second part of each layer is a feed-forward layer, which works on each token alone, with the same weights for every token. The model here uses SwiGLU, which has three weight matrices: $W_1$, $W_2$ and $W_3$.

$$
\text{FFN}(x) = W_2\left(\text{SiLU}(W_1 x) \odot W_3 x\right)
\qquad
\text{SiLU}(z) = z \cdot \text{sigmoid}(z)
$$

The symbol $\odot$ means that the two vectors are multiplied one number at a time. First, $W_1$ and $W_3$ make two wider vectors of `d_ff` numbers each. Second, the SiLU of the first vector acts as a gate, so where the gate is near 0, the column adds almost nothing.{% include components/sidenote.html id="sn-glu" label="7" text="The gate multiplies two functions of the same input, so one feature of a token can turn another feature on or off. A layer without a gate needs more width to get a similar effect. The paper gives no full explanation of why the gate helps." %} Third, $W_2$ brings the vector back to `d_model` numbers.

{% include components/tf.html diagram="swiglu" %}

For a large positive number, SiLU gives almost the same number, and for a large negative number, it gives almost 0. Between the two, the curve goes a little below 0.

SwiGLU comes from [GLU Variants Improve Transformer](https://arxiv.org/abs/2002.05202) (Shazeer, 2020). The original transformer used a simpler feed-forward layer without a gate.

## From vectors to the next token

After the last layer, a final RMSNorm gives all the vectors the same norm. Then the LM head, which is one more weight matrix, changes each vector into one score for each token of the vocabulary. The scores are called logits, and softmax changes them into probabilities:

$$
p_i = \frac{e^{z_i}}{\sum_j e^{z_j}}
$$

The diagram shows the logits of the last token, `␣hat`, for eight tokens of the vocabulary, and the probabilities in the diagram are for the eight tokens only.

{% include components/tf.html diagram="output" %}

The model gives a guess at every position, e.g., the guess at `␣cat` is for the token after `␣cat`. The 3D view at the top shows a guess for each position.

The model here is decoder-only, which means that it keeps one half of the original transformer. The original transformer was for translation, and it had two halves. The encoder read the input sentence, and the decoder wrote the translation one token at a time. [GPT](https://cdn.openai.com/research-covers/language-unsupervised/language_understanding_paper.pdf) (Radford and others, 2018) kept only the decoder and trained it to guess the next token, and the model here has the same design. The causal mask in attention makes the model a decoder, because each token sees only the tokens before it.{% include components/sidenote.html id="sn-cache" label="8" text="Because each token sees only the tokens before it, the keys and values of a token never change when new tokens come after it. When the model writes text one token at a time, it keeps the keys and values of the earlier tokens and calculates them only for the new token. The stored keys and values are called the KV cache, and with the cache each new token needs one new row of attention scores instead of the full grid." %}

## Counting weights, FLOPs and memory

| Letter | Meaning |
|---|---|
| $B$ | The number of texts in a batch |
| $T$ | The number of tokens in each text |
| $d$ | The number of numbers in each vector (`d_model`) |
| $h$ | The number of heads |
| $d_{ff}$ | The width of the middle of the feed-forward layer |
| $V$ | The number of tokens in the vocabulary |
| $L$ | The number of layers |

The next table follows the data through the model, and its last column gives the count of numbers in each tensor.

| Tensor | Shape | Numbers |
|---|---|---|
| Token ids | $(B, T)$ | $BT$ |
| Embeddings, and the stream | $(B, T, d)$ | $BTd$ |
| Q, K or V, split into heads | $(B, h, T, d/h)$ | $BTd$ |
| Attention scores | $(B, h, T, T)$ | $BhT^2$ |
| Attention output | $(B, T, d)$ | $BTd$ |
| Middle of the feed-forward layer | $(B, T, d_{ff})$ | $BTd_{ff}$ |
| Logits | $(B, T, V)$ | $BTV$ |

Each row of the attention scores has one score for each token, so the scores have $T^2$ numbers for each head. All the other tensors grow in proportion to $T$.

### Weights

A weight is one learned number of the model. The table counts the weights of each part, and $P$ is the total.

| Part | Weights |
|---|---|
| Embedding table | $Vd$ |
| Q, K, V and output matrices, in one layer | $4d^2$ |
| Feed-forward layer ($W_1$, $W_2$ and $W_3$), in one layer | $3d\,d_{ff}$ |
| Two RMSNorms, in one layer | $2d$ |
| Final RMSNorm | $d$ |
| LM head | $Vd$ |

$$
P = L\,(4d^2 + 3d\,d_{ff} + 2d) + d + 2Vd
$$

RoPE has no weights, because its angles come from a fixed formula. In float32, each weight takes 4 bytes, so the weights alone take $4P$ bytes.

### FLOPs

A FLOP is one floating-point operation, e.g., one multiplication or one addition. The product of an $m \times n$ matrix and an $n \times p$ matrix takes $2mnp$ FLOPs, because each of the $mp$ outputs needs $n$ multiplications and $n$ additions. The matrix products do almost all the work, so the table counts only them, for one forward pass over a batch.

| Matrix product | FLOPs |
|---|---|
| Q, K and V, in one layer | $6BTd^2$ |
| Scores $QK^\top$ for all the heads, in one layer | $2BT^2d$ |
| Weighted sum of the values, in one layer | $2BT^2d$ |
| Output matrix, in one layer | $2BTd^2$ |
| Feed-forward layer, in one layer | $6BTd\,d_{ff}$ |
| LM head | $2BTdV$ |

The total for one forward pass is $F$:

$$
F = L\,(8BTd^2 + 4BT^2d + 6BTd\,d_{ff}) + 2BTdV
$$

RMSNorm, softmax, RoPE and the additions do only a few FLOPs for each number, so they are small next to the matrix products. The FLOPs and the weights are closely related. Take one token, with a vector $x$ of $n$ numbers, and a weight matrix $W$ of size $n \times p$. To compute output $j$, the model multiplies each $x_i$ by the weight $W_{ij}$ and adds the result to the sum. Thus each of the $np$ weights is used one time, for one multiplication and one addition, and the token costs $2np$ FLOPs, which is 2 FLOPs for each weight.

The same is true for the whole model. If you divide $F$ by the $BT$ tokens and leave out the score terms, you get

$$
L\,(8d^2 + 6d\,d_{ff}) + 2dV = 2\,\big(L\,(4d^2 + 3d\,d_{ff}) + dV\big),
$$

which is 2 times the weights in the matrices. The embedding table only does a lookup, and the RMSNorm weights are few, so the forward pass is about $2P$ FLOPs for each token, plus $4LTd$ for each token for the attention scores.

For a short text, the $d^2$ and $d\,d_{ff}$ terms are the largest, and the feed-forward layer does the most work. The score terms grow with $T^2$, and in each layer they pass the feed-forward layer when $4T^2d > 6Td\,d_{ff}$, which is when $T > \tfrac{3}{2}d_{ff}$. In a larger model, the LM head is a smaller part of the work, because the layers grow with $Ld^2$ and the LM head grows only with $dV$.

### Memory for training

Training keeps four kinds of numbers in memory. AdamW, the optimizer that updates the weights, keeps two running averages for each weight, and the backward pass needs a gradient for each weight and the activations of the forward pass. In float32, each number takes 4 bytes.

| What | Numbers | Bytes |
|---|---|---|
| Weights | $P$ | $4P$ |
| Gradients, one for each weight | $P$ | $4P$ |
| AdamW state, two averages for each weight | $2P$ | $8P$ |
| Activations | $A$ | $4A$ |

The activations are the outputs of the steps of the forward pass, and the model keeps them until the backward pass uses them. The table counts the main tensors.

| Tensors | Numbers |
|---|---|
| Outputs of the two RMSNorms, in one layer | $2BTd$ |
| Q, K and V, in one layer | $3BTd$ |
| Scores and softmax weights, in one layer | $2BhT^2$ |
| Weighted sum and output matrix, in one layer | $2BTd$ |
| $W_1x$, $W_3x$, the SiLU and the gate product, in one layer | $4BTd_{ff}$ |
| Output of $W_2$, in one layer | $BTd$ |
| Final RMSNorm | $BTd$ |
| Logits, and their softmax for the loss | $2BTV$ |

$$
A \approx L\,(8BTd + 4BTd_{ff} + 2BhT^2) + BTd + 2BTV
$$

The peak memory is about $16P + 4A$ bytes. The $16P$ part doesn't depend on the batch, and the weights are only a quarter of it. $A$ grows in proportion to $B$, so the largest batch that fits is the memory that is left after the $16P$ bytes, divided by $4A$ for one text.

### Time for training

The backward pass does about two times the FLOPs of the forward pass.{% include components/sidenote.html id="sn-backward" label="9" text="For each matrix product $Y = XW$, the backward pass needs the gradient for the input, $\nabla_X = \nabla_Y W^\top$, and the gradient for the weights, $\nabla_W = X^\top \nabla_Y$. Each one is a product of the same size as the forward product, so the backward pass does about two times the work. The gradient for the weights needs $X$, which is the reason that the model keeps the activations." %} One step of AdamW does about 14 FLOPs for each weight, which is small next to $F$. Thus one training step takes about $3F$ FLOPs, and $S$ steps take this time:

$$
\text{time} \approx \frac{3F \cdot S}{\text{MFU} \cdot \text{peak FLOP/s}}
$$

The peak FLOP/s is the speed of the hardware. The MFU (model FLOPs utilization) is the fraction of the peak that the training gets in practice. Since the forward pass is about $2P$ FLOPs for each token, training is about $6P$ FLOPs for each token. [Scaling Laws for Neural Language Models](https://arxiv.org/abs/2001.08361) (Kaplan and others, 2020) uses the same rule, $C \approx 6ND$, where $C$ is the training FLOPs, $N$ is the number of weights without the embeddings, and $D$ is the number of training tokens.
