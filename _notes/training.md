---
layout: notes
title: "Training neural networks"
date: 2026-10-18
tags: ["llm", "training", "optimization"]
project: llm-from-scratch
part: 4
published: true
extra_css:
  - /assets/css/transformer.css
  - /assets/css/training.css
---

Training finds the weights that make a neural network give the right outputs. The sections below cover the parts of training that most networks share, and the last section shows how a trained language model generates text.

## Contents

<div class="ia-toc" markdown="1">

- [What training does](#what-training-does)
- [Activation functions](#activation-functions)
- [Weight initialization](#weight-initialization)
- [Loss functions](#loss-functions)
- [Gradients](#gradients)
- [Optimizers](#optimizers)
- [Learning rate schedule](#learning-rate-schedule)
- [Gradient clipping](#gradient-clipping)
- [The training loop](#the-training-loop)
- [Generating text](#generating-text)
- [Further reading](#further-reading)

</div>

## What training does

A neural network is a function with many weights, and the output that it computes for an input depends on the weights. At the start, the weights are random numbers, so the outputs are wrong. Training changes the weights a little at a time, so that the outputs get closer to the right outputs in the training data.

Each step of training goes through the same parts, in order:

1. The model reads a batch of examples and computes its outputs.
2. A loss function gives one number that says how wrong the outputs are.
3. The gradients say how the loss changes when each weight changes.
4. An optimizer uses the gradients to change the weights.

The examples in the note use a small task, which is to predict a number $y$ from a number $x$. The simplest model for the task is a line, $\hat{y} = wx + b$, with two weights $w$ and $b$. A language model works the same way at a much larger scale. Its input is a list of tokens, and its output is a probability for each possible next token.

The diagram runs the four parts on a small network with one input $x$ and one output $\hat{y}$. Between them are five hidden units, which are the numbers that the network computes on the way from the input to the output. Each step takes one of the points on the right as its example. You can go through the four parts of one step, or you can train for many steps and see the curve of the network move toward the points.

{% include components/train.html diagram="network" %}

## Activation functions

A neural network is a stack of layers, and most layers are linear layers with an activation function after them. A linear layer computes each of its outputs, or units, as a weighted sum of its inputs plus one more number, called a bias. With all the weights in a table $W$ and all the biases in a list $b$, the layer computes $Wx + b$. An activation function is a simple function that the network applies to each number after a linear layer.

Without an activation function, many layers are no better than one layer. If you leave out the biases, two linear layers in a row give $W_2(W_1 x) = (W_2 W_1)\,x$. The result is again one linear layer, with the table $W_2 W_1$. Thus a stack of linear layers can only give a straight line, or a flat plane for many inputs, however many layers it has. An activation function between the layers lets each layer bend the output, so a network with enough units can follow almost any curve.{% include components/sidenote.html id="sn-bends" label="1" text="A network of ReLUs computes a function made of straight pieces. With one input and one layer of $n$ ReLU units, each unit adds at most one bend, at the input where its own input crosses 0. Thus the output is a curve with up to $n$ bends, and more bends can follow a curve more closely." %}

In the diagram, a network with one layer of units fits the points as well as it can. You can choose the activation function and the number of units.

{% include components/train.html diagram="activation" %}

| Name | Formula | Shape |
|---|---|---|
| ReLU | $\max(0, z)$ | 0 for negative inputs, and $z$ for positive inputs |
| GELU | $z \cdot \Phi(z)$ | A smooth version of ReLU |
| SiLU | $z \cdot \text{sigmoid}(z)$ | A smooth version of ReLU, close to GELU |

Older networks used the sigmoid and tanh functions, which are smooth steps between two values. For large positive or negative inputs, both curves become flat, so their slope is near 0. Training changes a weight by an amount that depends on the slopes after it, so in a deep network of sigmoids, the weights of the first layers barely change. The problem is called the vanishing gradient.

ReLU doesn't become flat for positive inputs, because its slope is 1 for every positive input. It is also cheap to compute, and it became common after [Rectified Linear Units Improve Restricted Boltzmann Machines](https://www.cs.toronto.edu/~hinton/absps/reluICML.pdf) (Nair and Hinton, 2010). A ReLU unit whose input is always negative always gives 0 and has a slope of 0. Its weights then stop changing, and the unit is called a dead ReLU. Leaky ReLU, from [Maas and others (2013)](https://ai.stanford.edu/~amaas/papers/relu_hybrid_icml2013_final.pdf), gives negative inputs a small slope instead, e.g., $0.01\,z$, so its units can't die.

GELU and SiLU multiply $z$ by a smooth step that goes from 0 for large negative $z$ to 1 for large positive $z$. GELU, from [Gaussian Error Linear Units](https://arxiv.org/abs/1606.08415) (Hendrycks and Gimpel, 2016), uses the step $\Phi(z)$ from the normal distribution. SiLU, from [Elfwing and others (2017)](https://arxiv.org/abs/1702.03118), uses the sigmoid, $1 / (1 + e^{-z})$. [Ramachandran and others (2017)](https://arxiv.org/abs/1710.05941) found the same function in a search and called it Swish. Both curves are smooth, and they go a little below 0 for negative inputs instead of being exactly flat.

## Weight initialization

The starting weights decide whether the signal keeps its size as it goes through the layers. The size of a set of numbers around 0 is measured by the variance, which is the average of their squares. Each output of a linear layer adds up $n$ products, one for each input. If the inputs have a variance of 1 and the weights have a variance of $\sigma^2$, the output has a variance of about $n\sigma^2$. So with $\sigma^2 = 1/n$, the output keeps the size of the input.

With a larger $\sigma^2$, the signal grows at every layer, and with a smaller one it shrinks at every layer. After many layers, the signal becomes very large or almost 0. The gradients go back through the same weights, so they grow or shrink in the same way.

[Understanding the Difficulty of Training Deep Feedforward Neural Networks](https://proceedings.mlr.press/v9/glorot10a.html) (Glorot and Bengio, 2010) chose $\sigma^2 = 2/(n_{in} + n_{out})$, which keeps both the forward signal and the backward gradients at about the same size. For a layer with as many outputs as inputs, the variance is $1/n$. A ReLU sets about half of the numbers to 0, which halves the variance, so [He and others (2015)](https://arxiv.org/abs/1502.01852) doubled it to $\sigma^2 = 2/n$ for ReLU networks.

The biases usually start at 0. Many models draw each weight at random from a bell curve, and they draw again any value more than 3 times the typical size away from 0, so that no single weight starts very large. A bell curve with its ends cut off in the same way is called a truncated normal distribution.

The weights must also be random and not all equal. If all the weights of a layer are equal, every unit in the layer computes the same output and gets the same gradient. The units then stay equal for all of the training.

## Loss functions

A loss function gives one number that says how wrong the model is on an example. A loss of 0 means that the output is exactly right, and training tries to make the average loss over the data as small as possible. The right loss depends on what the model predicts.

To predict a number, the usual loss is the mean squared error, which is $(\hat{y} - y)^2$ averaged over the examples. Squaring makes every error positive, and it makes a large error count much more than a small one.

To predict a class, which is one answer from a fixed list, e.g., the next token from a vocabulary, the model gives a probability for each class. The usual loss is cross-entropy:

$$
\ell = -\log p_y
$$

Here $p_y$ is the probability that the model gives to the right class. If the model gives the right token a probability of 1, the loss is 0. A probability of 0.5 gives a loss of about 0.69, and a probability of 0.01 gives a loss of about 4.6. The loss grows without limit as $p_y$ goes to 0, so a confident wrong answer costs much more than an unsure one.{% include components/sidenote.html id="sn-pminusy" label="2" text="With softmax and cross-entropy together, the gradient of the loss for the logit of class $i$ is $p_i - y_i$, where $y_i$ is 1 for the right class and 0 for the others. Thus each step raises the logit of the right class in proportion to $1 - p_y$, and it lowers every other logit in proportion to its probability. A class that the model already gives almost 0 gets almost no change." %}

The model doesn't give probabilities directly. It gives one score $z_i$ for each class, called a logit, and a function called softmax changes the logits into probabilities. If you put the softmax into the loss, you can write the loss with the logits:

$$
p_i = \frac{e^{z_i}}{\sum_j e^{z_j}}
\qquad
\ell = -\log p_y = -z_y + \log \sum_j e^{z_j}
$$

In the second formula, the term $-z_y$ becomes smaller when the logit of the right class becomes larger. The term $\log \sum_j e^{z_j}$ is close to the largest logit, so it becomes smaller when the logits of the other classes become smaller.

For example, take three tokens with the logits $z = (2, 1, 0)$, and let the second token be the right one:

$$
\begin{aligned}
\textstyle\sum_j e^{z_j} &= e^{2} + e^{1} + e^{0} \approx 7.39 + 2.72 + 1 = 11.11 \\
p &\approx (0.665,\ 0.245,\ 0.090) \\
\ell &\approx -\log 0.245 \approx 1.41
\end{aligned}
$$

If the logit of the second token grows from 1 to 3, its probability becomes about 0.71, and the loss falls to about 0.35.

The probability of a whole text is the product of the probabilities of its tokens, one after the other. The log of a product is a sum of logs, so the average cross-entropy over a text is $-\frac{1}{N}$ times the log of the probability of the whole text. A lower loss therefore means that the model gives the real text a higher probability.

In practice, the model computes the loss from the logits, as in the second formula, instead of computing the softmax first. It also subtracts the largest logit from all the logits, because $e^{z}$ is too large for the computer to store for a large $z$. The subtraction doesn't change the result.

## Gradients

The gradient tells, for each weight, how fast the loss changes when the weight changes a little. For one weight $w$, it is the slope of the loss, written $\partial \ell / \partial w$. A positive slope means that a larger $w$ gives a larger loss, so the weight should become smaller. A negative slope means the opposite. The gradient is the list of these slopes, one for each weight.

For example, take the line model and one example $(x, y)$, with the loss $\ell = (wx + b - y)^2$. The slope for $w$ is $2(wx + b - y)\,x$. If the prediction is too large, $wx + b - y$ is positive. For a positive $x$, the slope is then positive, so a smaller $w$ gives a smaller loss.

In the diagram, you can move $w$, or you can take steps that move $w$ against its slope. The dashed line has the slope of the loss at the current $w$.

{% include components/train.html diagram="gradient" %}

Backpropagation computes all the slopes in one pass back through the network. A network is a chain of simple steps, and the chain rule from calculus says that the slope through a chain is the product of the slopes of its steps. Backpropagation starts at the loss and goes back one step at a time, and at each step it multiplies by the slope of the step.{% include components/sidenote.html id="sn-backprop" label="3" text="To find the slope for one weight by trial, you can change the weight a little and run the network again. A model with $P$ weights would need $P$ extra runs for one training step. Backpropagation gets all $P$ slopes for about two times the cost of one forward pass, so a network with millions of weights is practical to train." %} [Learning Representations by Back-propagating Errors](https://www.nature.com/articles/323533a0) (Rumelhart, Hinton and Williams, 1986) made backpropagation the standard way to train networks with hidden layers.

Because the slopes multiply, many small slopes in a row give a very small gradient for the first layers. The vanishing gradient from the activation section is the result of the product.

## Optimizers

An optimizer is the rule that uses the gradients to change the weights. Each optimizer below fixes a problem of the one before it.

### SGD

Gradient descent changes each weight by a small step against its slope:

$$
\theta \leftarrow \theta - \eta\, g
$$

Here $\theta$ is a weight, $g$ is its gradient, and $\eta$ is the learning rate. A gradient over all the training data is slow to compute, so stochastic gradient descent (SGD) computes it on a small random batch of examples instead. Stochastic means random, and the idea is from [A Stochastic Approximation Method](https://doi.org/10.1214/aoms/1177729586) (Robbins and Monro, 1951). The gradient of a batch is close to the gradient of all the data but not exactly equal to it, and it is much cheaper to compute.

The learning rate sets the size of each step. If it is too small, the loss goes down slowly. If it is too large, each step goes past the lowest point, and the loss goes up instead of down. With a very large learning rate, the weights grow without limit.

### Momentum

SGD has trouble when the loss changes fast along one direction and slowly along another. It moves back and forth along the fast direction, and it makes little progress along the slow one. Momentum fixes the problem with an average of the recent gradients, in which older gradients count less and less. It then steps along the average:

$$
m \leftarrow \beta\, m + g, \qquad \theta \leftarrow \theta - \eta\, m
$$

A direction where the gradient changes sign from step to step cancels out in the average, and a direction where it keeps the same sign builds up.{% include components/sidenote.html id="sn-kappa" label="4" text="On a loss shaped like a long narrow valley, let $\kappa$ be the ratio of the steepest curvature to the shallowest one, where curvature is how fast the slope changes. With the best learning rate, SGD needs a number of steps that grows in proportion to $\kappa$, and momentum needs a number that grows only with $\sqrt{\kappa}$. For $\kappa = 100$, momentum needs about 10 times fewer steps. [Why Momentum Really Works](https://distill.pub/2017/momentum/) (Goh, 2017) shows the result with interactive diagrams." %} [On the Importance of Initialization and Momentum in Deep Learning](https://proceedings.mlr.press/v28/sutskever13.html) (Sutskever and others, 2013) showed that momentum is important for training deep networks.

### Adam

Different weights can have gradients of very different sizes, and one learning rate can't suit all of them. [Adam](https://arxiv.org/abs/1412.6980) (Kingma and Ba, 2014) keeps two averages for each weight, in the same way as momentum. The first, $m$, is the average gradient, and the second, $v$, is the average squared gradient, which measures the typical size of the gradient:

$$
m \leftarrow \beta_1 m + (1 - \beta_1)\, g, \qquad
v \leftarrow \beta_2 v + (1 - \beta_2)\, g^2, \qquad
\theta \leftarrow \theta - \eta\, \frac{\hat{m}}{\sqrt{\hat{v}} + \varepsilon}
$$

The average $m$ is momentum. The division by $\sqrt{\hat{v}}$ is from RMSprop, which Hinton described in his [lecture slides](https://www.cs.toronto.edu/~tijmen/csc321/slides/lecture_slides_lec6.pdf) (2012), and it gives each weight a step of about the same size, whether its gradients are large or small.{% include components/sidenote.html id="sn-adamstep" label="5" text="When the gradient of a weight is steady, $\hat{m} / \sqrt{\hat{v}}$ is close to 1 or -1, so the step is close to $\eta$. Thus in Adam the learning rate is about the largest change of a weight in one step, whatever the units of the loss. In SGD the step is $\eta g$, so the right learning rate depends on the scale of the gradients." %} The averages $m$ and $v$ start at 0, so in the first steps they are too small. Adam corrects them as $\hat{m} = m / (1 - \beta_1^t)$ and $\hat{v} = v / (1 - \beta_2^t)$, where $t$ is the step number. The small number $\varepsilon$ stops a division by zero.

The diagram runs SGD, momentum and Adam from the same start, and the chart under it shows the loss at each step. The first surface is a narrow valley, where the loss changes fast along one direction and slowly along the other. The second surface is a saddle point, where the gradient is 0 but the loss still goes down along one direction. In a network with many weights, most points where the gradient is 0 are saddle points and not low points, as [Dauphin and others (2014)](https://arxiv.org/abs/1406.2572) argued. You can change the learning rate, and you can add noise to the gradients, as small batches do.

{% include components/train.html diagram="optim" %}

### AdamW

Weight decay makes the weights a little smaller at each step, which keeps them from growing large and helps the model work on new data. The usual way to add weight decay to SGD is an extra term in the loss, $\tfrac{\lambda}{2}\lVert\theta\rVert^2$, where $\lVert\theta\rVert^2$ is the sum of the squares of all the weights. The gradient of the term is $\lambda\theta$. In Adam, the extra gradient goes through the division by $\sqrt{\hat{v}}$, so weights with large gradients get less decay than the others.

[Decoupled Weight Decay Regularization](https://arxiv.org/abs/1711.05101) (Loshchilov and Hutter, 2017) takes the decay out of the gradient and applies it to the weights directly, after the Adam step:

$$
\theta \leftarrow \theta - \eta\lambda\,\theta
$$

The method is called AdamW, and most language models train with it. Adam and AdamW keep $m$ and $v$ for each weight, so they need two extra numbers in memory for each weight.

## Learning rate schedule

Most training runs change the learning rate during training. In a common schedule, the learning rate first grows and then goes down:

1. During the warmup, the learning rate grows from 0 to its largest value $\eta_{max}$ over the first $T_w$ steps.
2. After the warmup, the learning rate goes down along a cosine curve to a small value $\eta_{min}$ at step $T_c$.

$$
\eta_t = \eta_{min} + \tfrac{1}{2}\left(1 + \cos\!\left(\pi\,\frac{t - T_w}{T_c - T_w}\right)\right)(\eta_{max} - \eta_{min})
$$

{% include components/train.html diagram="schedule" %}

The cosine schedule is from [SGDR](https://arxiv.org/abs/1608.03983) (Loshchilov and Hutter, 2016). Early in training, large steps make fast progress. Near the end, the noise of the batches keeps the weights moving around the lowest point, and smaller steps let them settle closer to it.

The warmup helps because large steps can make the start of training unstable. At the start, the weights are random, and the gradients can be large and change fast. The transformer paper used a warmup, and [Accurate, Large Minibatch SGD](https://arxiv.org/abs/1706.02677) (Goyal and others, 2017) used one to train with very large batches.{% include components/sidenote.html id="sn-warmup" label="6" text="Adam has its own reason to need a warmup. In the first steps, $v$ is an average of only a few squared gradients, so it is a poor estimate. The division by $\sqrt{v}$ can then give some weights very large steps. [Liu and others (2019)](https://arxiv.org/abs/1908.03265) showed that the warmup works because it keeps the steps small until $v$ is a good estimate." %}

## Gradient clipping

Gradient clipping limits the size of the step when one batch gives a very large gradient, e.g., because of an unusual example. Without clipping, one large step can undo a lot of training. The size of the gradient is its norm $\lVert g \rVert$, which is the square root of the sum of the squares of all its numbers. If the norm is larger than a limit $c$, the optimizer uses a smaller gradient instead:

$$
g \leftarrow g \cdot \frac{c}{\lVert g \rVert}
$$

The new gradient points in the same direction as before, and its norm is $c$. Most batches are below the limit, and clipping doesn't change them. Clipping is from [On the Difficulty of Training Recurrent Neural Networks](https://arxiv.org/abs/1211.5063) (Pascanu, Mikolov and Bengio, 2012).

## The training loop

The training loop repeats one step many times. For a language model, each step does the following, in order:

1. The loop takes a batch of $B$ random pieces of the training text, each $T + 1$ tokens long. The input is the first $T$ tokens, and the target is the same tokens moved by one position, so the target at each position is the next token.
2. The forward pass runs the model on the input, and it computes the logits and the average cross-entropy loss.
3. The backward pass computes the gradients with backpropagation.
4. The loop clips the gradients, sets the learning rate from the schedule, and lets the optimizer change the weights.
5. The loop sets the gradients back to zero, because most libraries add new gradients to the old ones.

For example, the piece `the cat saw the hat` gives the input and the target in the diagram.

{% include components/train.html diagram="batch" %}

The batch size $B$ is the number of examples in one gradient, and a larger batch gives a gradient that is closer to the gradient of all the data. The hardware computes the examples of a batch at the same time, but a larger batch needs more memory. For SGD, a common rule is to make the learning rate $k$ times larger when the batch becomes $k$ times larger, with a warmup at the start (Goyal and others, 2017). The rule works up to a limit, called the critical batch size. [An Empirical Model of Large-Batch Training](https://arxiv.org/abs/1812.06162) (McCandlish and others, 2018) showed that above the critical batch size, a larger batch barely reduces the number of steps. Most of the extra examples in each batch are then wasted.

Gradient accumulation gives the gradient of a large batch with the memory of a small one. The loop runs the forward and backward passes on $k$ small batches, with each loss divided by $k$. The gradients add up, as they do in most libraries, and then the optimizer takes one step. The result is the same as one step on a batch $k$ times larger.

Every few hundred steps, the loop computes the loss on validation data, which is text that the model never trains on. The training loss can keep going down even when the model gets no better on new text, and the validation loss shows the difference. When the validation loss starts to go up while the training loss still goes down, the model overfits. It has started to fit details of the training data that don't carry over to new text.

The loop also saves checkpoints. A checkpoint is a file with the weights, the optimizer state ($m$ and $v$ for AdamW) and the step number, so a run can stop and continue later from the same point. Without the optimizer state, the run would start Adam's averages again from 0.

## Generating text

A trained language model generates text one token at a time:

1. The model reads the text so far and gives probabilities for the next token.
2. A decoding rule picks one token from the probabilities.
3. The loop adds the token to the end of the text and starts again.

The loop stops at an end-of-text token or at a length limit. The decoding rule in step 2 has a large effect on the text.

Greedy decoding always picks the most likely token. It gives the same text every time, and it often repeats the same words in a loop. Sampling picks a random token with its probability, so a token with a probability of 0.3 is picked 30% of the time. The text is more varied, but the model sometimes picks a very unlikely token. The rest of the text then follows from the unlikely token.

Temperature changes how sharp the probabilities are. It divides the logits by a number $\tau$ before the softmax:

$$
p_i = \frac{e^{z_i / \tau}}{\sum_j e^{z_j / \tau}}
$$

With $\tau < 1$, the large logits become relatively larger, so the most likely tokens get even more of the probability. With $\tau > 1$, the probabilities become flatter. As $\tau$ goes to 0, sampling becomes greedy decoding, and as $\tau$ becomes very large, every token gets the same probability.

Top-p sampling keeps the smallest set of tokens whose probabilities add up to at least $p$, e.g., 0.9. It scales their probabilities so that they add up to 1, and it samples only from the set. When the model is sure, the set is small, and when the model is unsure, the set is large.{% include components/sidenote.html id="sn-topp" label="7" text="Top-k sampling keeps a fixed number $k$ of tokens. After `the cat saw the`, many tokens are reasonable, and after `once upon a`, almost only `␣time` is. A fixed $k$ is too small for the first case or too large for the second, and top-p changes the size of the set for each case." %} Top-p is from [The Curious Case of Neural Text Degeneration](https://arxiv.org/abs/1904.09751) (Holtzman and others, 2019), which found that top-p text was closer to human text than greedy text or text from plain sampling.

## Further reading

The notes and articles below explain the same ideas in more depth, with their own diagrams and animations:

- [CS231n: Neural Networks Part 1](https://cs231n.github.io/neural-networks-1/) covers activation functions, e.g., sigmoid, tanh, ReLU and Leaky ReLU.
- [CS231n: Backpropagation, Intuitions](https://cs231n.github.io/optimization-2/) works through backpropagation one step at a time on small circuits.
- [CS231n: Neural Networks Part 3](https://cs231n.github.io/neural-networks-3/) covers how to update the weights, how to set the learning rate and what to check during training. It has animations of optimizers on a valley and at a saddle point, by Alec Radford.
- [An Overview of Gradient Descent Optimization Algorithms](https://www.ruder.io/optimizing-gradient-descent/) (Ruder, 2016) compares SGD, momentum, Nesterov, Adagrad, RMSprop, Adam and other optimizers.
- [Why Momentum Really Works](https://distill.pub/2017/momentum/) (Goh, 2017) explains momentum with interactive diagrams.
