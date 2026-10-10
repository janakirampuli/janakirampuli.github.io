---
layout: notes
title: "BPE Tokenizer"
date: 2026-09-26
tags: ["llm", "tokenization", "bpe"]
project: llm-from-scratch
part: 1
published: true
---

These notes are for [assignment 1](https://github.com/stanford-cs336/assignment1-basics) of the Stanford CS336 course.

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
- [How fast can it go](#how-fast-can-it-go)
- [Takeaways](#takeaways)

</div>

## Why tokenize

A model cannot use text directly. A model uses numbers. Tokenization changes text into a list of numbers (token ids) and changes the ids back into text. The vocabulary is the fixed list of tokens that the tokenizer knows. Each token has an id.

The primary question is what these tokens must be. If the tokens are single characters or bytes, the vocabulary is small. But each text becomes a very long list of ids, and the model must process more ids. If the tokens are full words, the lists are short. But the vocabulary becomes very large, and a word that the tokenizer did not see before has no id.

Subwords are between these two options. A common word gets its own token. The tokenizer makes a rare word from smaller tokens. BPE (byte-pair encoding) is a standard procedure to learn these tokens from data.

The compression ratio is a simple number to compare tokenizers:

$$
\text{compression ratio} = \frac{\text{bytes of text}}{\text{number of tokens}}
$$

A higher ratio is better, because the same text becomes fewer ids.

The diagram below shows the full path from text to ids. The next sections explain each stage. You can change the text and the number of merges.

{% include components/tokenize.html text="the cat saw the hat 🙂<|endoftext|>" %}

## Byte representation

A computer keeps text as numbers. Unicode gives each character a number. This number is the code point. There are approximately 150,000 code points.

The code points could be the tokens, but that is not a good start. The vocabulary would have approximately 150,000 entries before training starts. Most of these characters are rare, so most of the entries would get almost no use.

UTF-8 changes each code point into 1 to 4 bytes. A byte is a number from 0 to 255. The table shows some examples:

| Character | Code point | UTF-8 bytes |
|---|---|---|
| `a` | U+0061 | `97` |
| `é` | U+00E9 | `195 169` |
| `牛` | U+725B | `231 137 155` |
| `🙂` | U+1F642 | `240 159 153 130` |

Thus all text becomes a list of numbers from 0 to 255. Byte-level BPE starts its vocabulary with these 256 byte values. It can encode all text, and this includes characters that were not in the training data. No character is unknown.

Bytes have two disadvantages. First, text in languages other than English starts with more tokens for each character, because those characters use more bytes. Second, not all byte lists are valid UTF-8. For example, the byte `195` must have a second byte after it. A list of tokens can stop in the middle of a multi-byte character. Thus the decoder must accept bytes that are not valid UTF-8.

Now the problem is clear. Use the sample sentence from the diagram above, `the cat saw the hat 🙂`. As bytes, it is this list:

```text
116 104 101 32 99 97 116 32 115 97 119 32 116 104 101 32 104 97 116 32 240 159 153 130
```

The sentence has 5 words and 1 emoji, but the list has 24 tokens. Each byte is one token, so the compression ratio is 1. Some groups of bytes occur more than one time. The bytes `116 104 101` (`the`) occur two times, and the bytes `97 116` (`at`) occur two times.

The problem is to find the groups of bytes that occur frequently and to make each group one token. Then the same sentence becomes a shorter list of ids. BPE training finds these groups in a large text.

## BPE algorithm

1. Pre-tokenize. Use the [GPT-2 regex](https://github.com/openai/gpt-2/blob/master/src/encoder.py#L53) to split the text into pre-tokens such as `"Hello"`, `" world"` and `"!"`. A merge does not go across the boundary of a pre-token. Thus `" the"` (with its initial space) and `"the"` are different words.
2. Process the special tokens first. Split the text at special tokens such as `<|endoftext|>` before you apply the regex. Put the special tokens directly into the vocabulary. Do not use them in merges.
3. Count. Keep each distinct pre-token as a tuple of byte tokens, together with the number of its occurrences.
4. Merge until the vocabulary is full. Count each pair of adjacent tokens. Multiply each count by the number of occurrences of the word. Then merge the most frequent pair in all words. Add the merged token to the vocabulary. Record the merge. If two counts are equal, use the pair that is last in the sort order. Compare the bytes as a dictionary compares letters.

This is a small example. The corpus is `" the"` ×5, `" then"` ×2, `" cat"` ×3 and `" hat"` ×1:

{% include components/bpe-train.html words=" the:5| then:2| cat:3| hat:1" merges="6" %}

Three pairs have a count of 7 at the start. The order of their first bytes is `'t'` > `'h'` > `' '`. Thus `('t','h')` is the first pair to merge.

In the first three merges, only 4 of the 9 initial pair counts changed. The pairs in `" cat"` and `" hat"` did not change. A merge changes only a small number of words. All the speed improvements below use this fact.

## Speed improvements

A real text has many thousands of distinct words, and training does thousands of merges. The four ideas below keep the work of each merge small. Each idea uses the small example from above. The symbol `␣` shows a space.

### Update only the words that change

The first merge in the example is `t` + `h`. Look at what it does to each word:

| Word | Count | After the merge | Changed? |
|---|---|---|---|
| `␣ t h e` | 5 | `␣ th e` | Yes |
| `␣ t h e n` | 2 | `␣ th e n` | Yes |
| `␣ c a t` | 3 | `␣ c a t` | No |
| `␣ h a t` | 1 | `␣ h a t` | No |

Two of the words did not change, so their pairs did not change. Thus change only the two words that contain `t h`. Change only the pair counts that come from those two words:

| Pair | Before | After |
|---|---|---|
| `t h` | 7 | 0 |
| `␣ t` | 7 | 0 |
| `h e` | 7 | 0 |
| `␣ th` | 0 | 7 |
| `th e` | 0 | 7 |

The other pair counts, such as `a t` and `c a`, stay the same. In a real text, a merge changes a small number of words out of many thousands. Thus each merge is a small quantity of work.

### Keep an index from each pair to its words

A merge of `t h` needs the words that contain `t h`. An index gives these words directly. Give each word a number:

| Number | Word |
|---|---|
| 0 | `␣ t h e` |
| 1 | `␣ t h e n` |
| 2 | `␣ c a t` |
| 3 | `␣ h a t` |

Then keep a table that shows, for each pair, the numbers of the words that contain it:

| Pair | Words |
|---|---|
| `t h` | 0, 1 |
| `h e` | 0, 1 |
| `a t` | 2, 3 |
| `c a` | 2 |
| `␣ h` | 3 |

To merge `t h`, look in the table. It gives words 0 and 1 immediately, and the code does not examine words 2 and 3. After the merge, add the new pairs to the table: `␣ th` and `th e` are in words 0 and 1.

### Use a heap to find the best pair

Each merge needs the pair with the highest count. The example has only 9 pairs, but a real text has many thousands of pairs.

A heap is a list that always keeps its largest item at the front. To get the largest item or to add a new item is fast. It is not necessary to compare all the items. Put all the pairs and their counts into a heap:

| Position | Pair | Count |
|---|---|---|
| Front | `t h` | 7 |
| | `h e` | 7 |
| | `␣ t` | 7 |
| | `a t` | 4 |
| | ... | |

The front of the heap is `t h`, so that is the first merge. The merge makes two new pairs, and each new pair goes into the heap with its count: `␣ th` with 7 and `th e` with 7.

A heap cannot change an entry that is already in it. Thus the old entries `h e` with 7 and `␣ t` with 7 stay in the heap, but the real count of these pairs is now 0. This is not a problem. When an entry comes to the front, compare its count with the real count of the pair. If the two counts are different, discard the entry and take the next one.

### Count each distinct word one time

The example text has 11 words, but only 4 of them are different. The word `␣the` occurs 5 times. A real text is the same: it has millions of words, but only some thousands of different words.

Thus count the words first:

| Word | Count |
|---|---|
| `␣the` | 5 |
| `␣cat` | 3 |
| `␣then` | 2 |
| `␣hat` | 1 |

Then change each different word into bytes one time. That is 4 conversions and not 11. In a real text, it is some thousands of conversions and not millions.

## Further improvements

On TinyStories, the main process waits for the workers for 87% of the time. In a worker, the regex `findall` uses 75% of the time. That is C code in the `regex` library.

OpenWebText is different. On the valid split (290 MB, vocabulary size 32,000), training takes 62 s. The merge loop uses approximately 89% of that time.

Web text has many rare words. A common pair is in approximately 204 distinct words for each merge. For TinyStories, the number is approximately 11. Each changed word also calculates all of its pairs again:

| For each merge, OWT valid | Count |
|---|---|
| Words changed | ~204 |
| Index insertions | ~1,840 |
| Heap pushes | ~115 |
| Heap pops (most are stale) | ~55 |

Only the pairs adjacent to a merge change. A merge of `(A,B)` in `[X, A, B, Y]` changes `(X,A)`, `(A,B)` and `(B,Y)` and no other pair. The next speed improvement is to update only those pairs.

Three cases must be correct. The first is a merge at the edge of a word. The second is a repeated sequence such as `[A,B,A,B]`. The third is a pair of the same token, such as `(A,A)` in `[A,A,A]`.

## Encoding and decoding

Training gives two things: the vocabulary and the list of merges, in the order that training found them. With these two things, the tokenizer can change text into ids and change ids back into text.

To encode is to change text into ids. The tokenizer splits the text into words, the same as in training. Then it applies the merges to each word, in the same order as training found them.

Take the word `␣then` and the merges from the example above. Training found these six merges, in this order:

| Merge | Pair | New token |
|---|---|---|
| 1 | `t` + `h` | `th` |
| 2 | `th` + `e` | `the` |
| 3 | `␣` + `the` | `␣the` |
| 4 | `a` + `t` | `at` |
| 5 | `c` + `at` | `cat` |
| 6 | `␣` + `cat` | `␣cat` |

The word starts as single bytes. The tokenizer tries each merge in order:

| Step | Tokens |
|---|---|
| Start | `␣` `t` `h` `e` `n` |
| Merge 1: `t` + `h` | `␣` `th` `e` `n` |
| Merge 2: `th` + `e` | `␣` `the` `n` |
| Merge 3: `␣` + `the` | `␣the` `n` |

Merges 4, 5 and 6 do not apply to this word, so the result is two tokens: `␣the` and `n`. The tokenizer finds the id of each token in the vocabulary. Thus a word of five bytes becomes two ids.

A special token such as `<|endoftext|>` is not split. It stays as one token and gets its own id.

To decode is to change ids back into text, and it is the easier direction. The tokenizer finds the bytes of each id, joins all the bytes, and reads the result as text. The two ids from above give `␣the` and `n`, and together they give `␣then` again.

One idea makes encoding much faster. A small number of common words make most of a text. The tokenizer can keep the ids of a word after the first time, and use them again each time the word occurs.

## How fast can it go

[Gigatoken](https://github.com/marcelroed/gigatoken){% include components/sidenote.html id="sn-giga" label="1" text="By Marcel Rød, one of the CS336 course staff." %} is a tokenizer written in Rust. It encodes the same OWT file at 8.8 GB/s on an M4 Max laptop. HuggingFace `tokenizers` does 6.9 MB/s and `tiktoken` does 63 MB/s. Thus the full 11 GB file takes less than 2 seconds. Gigatoken makes the same two parts faster that were slow in my code.

For pre-tokenization, it does not use a regex library. It uses a hand-written scanner that gives the same splits. The scanner examines 8 bytes at a time, and in a later version 64 bytes. On one CPU core, the speed increased from 47 MB/s with a regex library to more than 1 GB/s.

For the merges, it keeps the token ids of each word, as in the section above. 99.4% of the lookups find the word in the cache. Thus the merge code almost never runs, and most of the work was to make those lookups fast. Gigatoken also reads files directly and not through Python. It divides the work between all CPU cores and writes all the ids into one flat array.

I recommend that you read its optimization log, which also includes the ideas that did not work. Some changes that looked good made it slower. The log records these changes with their numbers.
