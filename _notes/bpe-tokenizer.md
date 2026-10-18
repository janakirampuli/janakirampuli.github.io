---
layout: notes
title: "BPE Tokenizer"
date: 2026-10-4
tags: ["llm", "tokenization", "bpe"]
project: llm-from-scratch
part: 1
published: true
---

A BPE (byte-pair encoding) tokenizer starts with the 256 byte values as its vocabulary. Training repeatedly merges the most frequent pair of adjacent tokens into a new token.

## Contents

<div class="ia-toc" markdown="1">

- [Why tokenize](#why-tokenize)
- [Byte representation](#byte-representation)
- [BPE algorithm](#bpe-algorithm)
- [Speed improvements](#speed-improvements)
  - [Update only the words that change](#update-only-the-words-that-change)
  - [Keep an index from each pair to its words](#keep-an-index-from-each-pair-to-its-words)
  - [Use a heap to find the best pair](#use-a-heap-to-find-the-best-pair)
  - [Count each distinct word one time](#count-each-distinct-word-one-time)
- [Further improvements](#further-improvements)
- [Encoding and decoding](#encoding-and-decoding)
- [Comparison with Gigatoken](#comparison-with-gigatoken)

</div>

## Why tokenize

A model works on numbers, so text has to be changed into numbers before a model can use it. Tokenization changes text into a list of numbers called token ids, and it also changes the ids back into text. The vocabulary is the fixed list of tokens that the tokenizer knows, and each token has an id.

The main design choice is what the tokens should be. If the tokens are single characters or bytes, the vocabulary is small, but each text becomes a very long list of ids for the model to process. If the tokens are whole words, the lists are short, but the vocabulary becomes very large. A word that the tokenizer hasn't seen also has no id.

Subword tokens are a middle choice. A common word gets its own token, and the tokenizer builds a rare word from smaller tokens. BPE is a standard procedure for learning subword tokens from data.

The compression ratio is a simple number for comparing tokenizers.

$$
\text{compression ratio} = \frac{\text{bytes of text}}{\text{number of tokens}}
$$

A higher ratio is better, because the same text becomes fewer ids.

## Byte representation

A computer stores text as numbers. Unicode gives each character a number called a code point, and there are approximately 150,000 code points.

Code points could be the tokens, but the vocabulary would have approximately 150,000 entries before training starts. Most of the characters are rare, so most of the entries would almost never be used.

UTF-8 changes each code point into 1 to 4 bytes, and a byte is a number from 0 to 255. The table shows some examples.

| Character | Code point | UTF-8 bytes |
|---|---|---|
| `a` | U+0061 | `97` |
| `é` | U+00E9 | `195 169` |
| `牛` | U+725B | `231 137 155` |
| `🙂` | U+1F642 | `240 159 153 130` |

So all text becomes a list of numbers from 0 to 255. Byte-level BPE starts its vocabulary with the 256 byte values, so it can encode any text, including characters that weren't in the training data. Byte-level BPE is from [GPT-2](https://cdn.openai.com/better-language-models/language_models_are_unsupervised_multitask_learners.pdf) (Radford and others, 2019).

Bytes have disadvantages. First, text in languages other than English starts with more tokens per character, because their characters use more bytes. Second, some byte lists aren't valid UTF-8. For example, the byte `195` must be followed by a second byte, and a list of tokens can stop in the middle of a multi-byte character. The decoder must therefore accept bytes that aren't valid UTF-8.

Starting from bytes also makes the lists long. For example, the sentence `the cat saw the hat 🙂` is the following list of bytes.

```text
116 104 101 32 99 97 116 32 115 97 119 32 116 104 101 32 104 97 116 32 240 159 153 130
```
{: .no-copy}

The sentence has 5 words and 1 emoji, but the list has 24 tokens. Each byte is one token, so the compression ratio is 1. Some groups of bytes occur more than once, e.g., the bytes `116 104 101` (`the`) occur twice, and the bytes `97 116` (`at`) occur twice.

The goal is to find the groups of bytes that occur often and to make each group one token, so the same sentence becomes a shorter list of ids. BPE training finds the groups in a large text.

## BPE algorithm

BPE started as a method to compress data. [Neural Machine Translation of Rare Words with Subword Units](https://arxiv.org/abs/1508.07909) (Sennrich and others, 2015) used it to split words into subwords, so a model can handle a rare word as a few smaller tokens.

BPE training runs the following steps in order.

1. Pre-tokenize. Use the [GPT-2 regex](https://github.com/openai/gpt-2/blob/master/src/encoder.py#L53) to split the text into pre-tokens such as `"Hello"`, `" world"`, and `"!"`. A merge never crosses the boundary of a pre-token, so `" the"` (with its leading space) and `"the"` are different words.
2. Handle the special tokens first. Split the text at special tokens such as `<|endoftext|>` before you apply the regex. Put the special tokens directly into the vocabulary, and don't use them in merges.
3. Count. Store each distinct pre-token as a tuple of byte tokens, together with the number of times it occurs.
4. Merge until the vocabulary is full. Count each pair of adjacent tokens, and weight each count by the number of times the word occurs. Then merge the most frequent pair in all words. Add the merged token to the vocabulary, and record the merge. If two counts are equal, pick the pair that comes last when you compare the bytes in dictionary order.

The following example uses a small corpus, which is `" the"` ×5, `" then"` ×2, `" cat"` ×3, and `" hat"` ×1. The corpus has no special token, so the vocabulary starts with only the 256 byte values. The symbol `␣` stands for a space.

{% include components/bpe-train.html words=" the:5| then:2| cat:3| hat:1" merges="6" %}

Three pairs have a count of 7 at the start. Their first bytes are ordered `'t'` > `'h'` > `' '`, so `('t','h')` is the first pair to merge.

A merge changes only a small number of words. For example, in the first three merges, only 4 of the 9 initial pair counts changed, and the pairs in `" cat"` and `" hat"` didn't change.

## Speed improvements

Each merge has to be cheap, because a large text has many thousands of distinct words and training does thousands of merges. The ideas in the section keep the work of each merge small, and each idea is shown on the small example.

### Update only the words that change

The first merge in the example is `t` + `h`. The table shows what the merge does to each word.

| Word | Count | After the merge | Changed? |
|---|---|---|---|
| `␣ t h e` | 5 | `␣ th e` | Yes |
| `␣ t h e n` | 2 | `␣ th e n` | Yes |
| `␣ c a t` | 3 | `␣ c a t` | No |
| `␣ h a t` | 1 | `␣ h a t` | No |

Two of the words didn't change, so their pairs didn't change either. The code only has to change the two words that contain `t h`, and the pair counts that come from those two words.

| Pair | Before | After |
|---|---|---|
| `t h` | 7 | 0 |
| `␣ t` | 7 | 0 |
| `h e` | 7 | 0 |
| `␣ th` | 0 | 7 |
| `th e` | 0 | 7 |

The other pair counts, such as `a t` and `c a`, stay the same. In a large text, a merge changes a small number of words out of many thousands, so each merge is a small amount of work.

### Keep an index from each pair to its words

A merge of `t h` needs the words that contain `t h`, and an index gives the words directly. First, give each word a number.

| Number | Word |
|---|---|
| 0 | `␣ t h e` |
| 1 | `␣ t h e n` |
| 2 | `␣ c a t` |
| 3 | `␣ h a t` |

Then keep a table that lists, for each pair, the numbers of the words that contain it.

| Pair | Words |
|---|---|
| `t h` | 0, 1 |
| `h e` | 0, 1 |
| `a t` | 2, 3 |
| `c a` | 2 |
| `␣ h` | 3 |

To merge `t h`, the code looks up the pair in the table and gets words 0 and 1, so it never examines words 2 and 3. After the merge, the code adds the new pairs `␣ th` and `th e` to the table, both for words 0 and 1.

### Use a heap to find the best pair

Each merge needs the pair with the highest count. The example has only 9 pairs, but a large text has many thousands of pairs.

A heap is a data structure that always keeps its largest item at the front. Getting the largest item and adding a new item are both fast, because the heap doesn't compare all the items. Put all the pairs and their counts into a heap.

| Position | Pair | Count |
|---|---|---|
| Front | `t h` | 7 |
| | `h e` | 7 |
| | `␣ t` | 7 |
| | `a t` | 4 |
| | ... | |

The front of the heap is `t h`, so `t h` is the first merge. The merge creates two new pairs, and each one goes into the heap with its count, which is 7 for `␣ th` and 7 for `th e`.

A heap can't change an entry that is already in it, so the old entries `h e` with 7 and `␣ t` with 7 stay in the heap even though the current count of both pairs is 0. An entry with an outdated count is called stale. When an entry reaches the front, compare its count with the current count of the pair. If the counts differ, discard the entry and take the next one.

### Count each distinct word one time

The example text has 11 words, but only 4 of them are distinct, e.g., the word `␣the` occurs 5 times. A large text is similar, with millions of words but only some thousands of distinct words, so count the words first.

| Word | Count |
|---|---|
| `␣the` | 5 |
| `␣cat` | 3 |
| `␣then` | 2 |
| `␣hat` | 1 |

Then change each distinct word into bytes once. The example needs 4 conversions instead of 11, and a large text needs some thousands of conversions instead of millions.

## Further improvements

My implementation spends its time in different places on the two datasets. On TinyStories, the main process waits for the workers for 87% of the time. Inside a worker, the regex `findall` call takes 75% of the time, and the call is C code in the `regex` library.

On OpenWebText, the merge loop takes most of the time. Training on the validation split (290 MB, vocabulary size 32,000) takes 62 s, and the merge loop uses approximately 89% of it.

Web text has many rare words, so each merge touches more words. On OpenWebText, a merged pair is in approximately 204 distinct words per merge, and on TinyStories the number is approximately 11. Each changed word also recomputes all of its pairs.

| Per merge, OpenWebText validation split | Count |
|---|---|
| Words changed | ~204 |
| Index insertions | ~1,840 |
| Heap pushes | ~115 |
| Heap pops (most are stale) | ~55 |

Only the pairs next to a merge change. A merge of `(A,B)` in `[X, A, B, Y]` changes `(X,A)`, `(A,B)`, and `(B,Y)` and no other pair, so the next speed improvement is to update only the three pairs.

The update has to be correct when a merge is at the edge of a word, and when a sequence repeats, such as `[A,B,A,B]`. It also has to be correct for a pair of the same token, such as `(A,A)` in `[A,A,A]`.

## Encoding and decoding

Training produces the vocabulary and the list of merges, in the order in which training found them. With both, the tokenizer can change text into ids and change ids back into text.

Encoding changes text into ids. The tokenizer splits the text into words in the same way as training, and then it applies the merges to each word in the order in which training found them.

For example, take the word `␣then` and the six merges that training found in the example.

| Merge | Pair | New token |
|---|---|---|
| 1 | `t` + `h` | `th` |
| 2 | `th` + `e` | `the` |
| 3 | `␣` + `the` | `␣the` |
| 4 | `a` + `t` | `at` |
| 5 | `c` + `at` | `cat` |
| 6 | `␣` + `cat` | `␣cat` |

The word starts as single bytes, and the tokenizer tries each merge in order.

| Step | Tokens |
|---|---|
| Start | `␣` `t` `h` `e` `n` |
| Merge 1: `t` + `h` | `␣` `th` `e` `n` |
| Merge 2: `th` + `e` | `␣` `the` `n` |
| Merge 3: `␣` + `the` | `␣the` `n` |

Merges 4, 5, and 6 don't apply to the word, so the result is the two tokens `␣the` and `n`. The tokenizer looks up the id of each token in the vocabulary, so a word of five bytes becomes two ids.

A special token such as `<|endoftext|>` is never split, so it stays as one token and gets its own id.

The diagram shows the full path from text to ids for one sentence, and you can change the text and the number of merges. The diagram trains its vocabulary in the page on five short sentences about a cat, a dog, and a hat, so a word that isn't in the five sentences stays as single bytes or small pieces.

{% include components/tokenize.html text="the cat saw the hat 🙂<|endoftext|>" %}

In the diagram, the ids 0 to 255 are the byte values, and the special token `<|endoftext|>` has id 256. The merged tokens start at id 257, in the order in which training found them. The order of the ids is a choice, and other tokenizers order their vocabulary differently.

The emoji isn't in the training sentences, so it stays as four tokens of one byte each. One byte of an emoji isn't valid UTF-8, so the diagram shows each of the four bytes as a hex value such as `\xf0`.

Decoding changes ids back into text, and it is the easier direction. The tokenizer looks up the bytes of each id and joins all the bytes, and then it reads the result as text. The two ids from the example give `␣the` and `n`, which join to give `␣then` again.

Caching makes encoding much faster, because a small number of common words make up most of a text. The tokenizer stores the ids of a word the first time it encodes the word, and it reuses them each time the word occurs again.

## Comparison with Gigatoken

[Gigatoken](https://github.com/marcelroed/gigatoken) is a tokenizer written in Rust that encodes the 11 GB OpenWebText file at 8.8 GB/s on an M4 Max laptop, so the full file takes less than 2 seconds. For comparison, HuggingFace `tokenizers` runs at 6.9 MB/s and `tiktoken` runs at 63 MB/s. Gigatoken speeds up the same two parts that were slow in my code, which are pre-tokenization and the merges.

For pre-tokenization, Gigatoken uses a hand-written scanner instead of a regex library, and the scanner gives the same splits. The scanner examines 8 bytes at a time, and a later version examines 64 bytes at a time. On one CPU core, the speed went from 47 MB/s with a regex library to more than 1 GB/s.

For the merges, Gigatoken caches the token ids of each word, as described in the encoding section. The cache has the word for 99.4% of the lookups, so the merge code almost never runs. Most of the work on Gigatoken therefore went into making the lookups fast. Gigatoken also reads files directly instead of through Python. It divides the work across all CPU cores, and it writes all the ids into one flat array.
