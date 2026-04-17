---
layout: notes
title: "Interactive kitchen sink"
date: 2026-02-24
tags: ["interactive", "demo"]
published: true
---

A **reference of the reusable components** available for writing notes on this site.

Each section shows the intended markup and how it renders. Components are designed to degrade gracefully: content stays readable even if JavaScript fails.

## Contents

<div class="ia-toc" markdown="1">

- [Callouts](#callouts)
- [Sidenotes](#sidenotes)
- [Tooltips](#tooltips)
- [Citations](#citations)
- [Tabs](#tabs)
- [Code & copy](#code-copy)
- [Mermaid diagrams](#mermaid)
- [Statements](#statements)
- [Quote](#quotes)
- [Checklist](#todo)
- [Toggles](#toggles)
- [Figures](#figures)
- [Margin figure](#marginfig)
- [Side-by-side](#sidebyside)
- [Math](#math)
- [Stepper](#stepper)
- [Tables](#tables)
- [References](#references)

</div>

---

<section class="ia-section" id="callouts" markdown="1">
  <div class="ia-section__header">
    <h2>Callouts</h2>
  </div>

Four kinds - `info` (default), `tip`, `warn`, `danger`. Use sparingly; a note that leans on callouts stops feeling like an essay.

{% capture cb_info %}
Callouts use a left rule and a small-caps label. No emoji, no fill.
{% endcapture %}
{% include components/callout.html type="info" content=cb_info %}

{% capture cb_tip %}
Prefer `torch.compile` once a kernel is stable - the overhead is paid per first run.
{% endcapture %}
{% include components/callout.html type="tip" title="Tip" content=cb_tip %}

{% capture cb_warn %}
`torch.cuda.synchronize()` will silently hide launch-latency regressions if you wrap all your timings with it.
{% endcapture %}
{% include components/callout.html type="warn" title="Warn" content=cb_warn %}

{% capture cb_danger %}
Do not `rm -rf` the wandb runs directory while a sweep is still writing.
{% endcapture %}
{% include components/callout.html type="danger" title="Danger" content=cb_danger %}

</section>

---

<section class="ia-section" id="sidenotes" markdown="1">
  <div class="ia-section__header">
    <h2>Sidenotes</h2>
  </div>

On desktop widths the note floats into the right margin{% include components/sidenote.html id="sn-1" label="1" text="Margin note on desktop, inline on mobile. Use for asides that should not break the reading flow." %}, and the paragraph continues without interruption. Use them for pointer-level remarks: citations, caveats, a nudge to see a related note.

</section>

---

<section class="ia-section" id="tooltips" markdown="1">
  <div class="ia-section__header">
    <h2>Tooltips</h2>
  </div>

Define a term inline like {% include components/tooltip.html label="**shared memory**" text="Fast on-chip memory shared by threads in a CUDA thread block." %} without breaking the paragraph. Hover or focus reveals the definition.

</section>

---

<section class="ia-section" id="citations" markdown="1">
  <div class="ia-section__header">
    <h2>Citations</h2>
  </div>

Drop inline references like {% include components/cite.html label="[1]" href="https://distill.pub/" bubble="**Distill.pub** popularized explorable explanations with strong typography and interactive components." %} in the middle of a sentence. The bubble appears on hover or focus and contains a short summary plus a link.

</section>

---

<section class="ia-section" id="tabs">
  <div class="ia-section__header">
    <h2>Tabs</h2>
  </div>

  <div class="ia-tabs" id="tabs-demo">
    <div class="ia-tabs__tablist" role="tablist" aria-label="Demo tabs">
      <button class="ia-tabs__tab" role="tab" aria-controls="tabs-demo-panel-0" aria-selected="true" type="button">C++</button>
      <button class="ia-tabs__tab" role="tab" aria-controls="tabs-demo-panel-1" aria-selected="false" type="button">Python</button>
    </div>

    <div class="ia-tabs__panel" id="tabs-demo-panel-0" role="tabpanel">
      {% highlight cpp %}
#include <iostream>

int main() {
  std::cout << "hello" << std::endl;
  return 0;
}
      {% endhighlight %}
    </div>

    <div class="ia-tabs__panel" id="tabs-demo-panel-1" role="tabpanel" hidden>
      {% highlight python %}
def main() -> None:
    print("hello")


if __name__ == "__main__":
    main()
      {% endhighlight %}
    </div>
  </div>

Arrow-key navigation works inside the tablist.

</section>

---

<section class="ia-section" id="code-copy" markdown="1">
  <div class="ia-section__header">
    <h2>Code &amp; copy</h2>
  </div>

Hover a code block to reveal the copy button.

```rust
fn main() {
    println!("Hello, world!");
}
```

</section>

---

<section class="ia-section" id="mermaid" markdown="1">
  <div class="ia-section__header">
    <h2>Mermaid diagrams</h2>
  </div>

```mermaid
flowchart LR
  A[Global memory] -->|load| B[Shared memory]
  B -->|reuse| C[Registers]
  C --> D[Compute]
```

</section>

---

<section class="ia-section" id="statements" markdown="1">
  <div class="ia-section__header">
    <h2>Statements</h2>
  </div>

Three kinds: `definition`, `theorem` / `lemma`, and `proof`.

  {% capture def_body %}
  **Softmax.** $\sigma(x)_i = \exp(x_i) / \sum_j \exp(x_j)$.
  {% endcapture %}
  {% include components/statement.html kind="definition" title="Softmax" body=def_body %}

  {% capture thm_body %}
  If $A$ is symmetric positive definite, then it admits a Cholesky factorization $A = LL^\top$ with $L$ lower triangular and $L_{ii} > 0$.
  {% endcapture %}
  {% include components/statement.html kind="theorem" title="Cholesky" body=thm_body %}

  {% capture proof_body %}
  Induct on matrix size. Split $A$ with a Schur complement; the complement inherits SPD and yields $L$ by induction.
  {% endcapture %}
  {% include components/statement.html kind="proof" body=proof_body %}

</section>

---

<section class="ia-section" id="quotes" markdown="1">
  <div class="ia-section__header">
    <h2>Quote</h2>
  </div>

  {% include components/quote.html
     text="Premature optimization is the root of all evil."
     author="Donald Knuth"
  %}

</section>

---

<section class="ia-section" id="todo" markdown="1">
  <div class="ia-section__header">
    <h2>Checklist</h2>
  </div>

  {% capture todo_body %}
  - [ ] Verify shapes match
  - [ ] Add ablation table
  - [x] Reproduce baseline
  - [x] Freeze random seed for reproducibility
  {% endcapture %}
  {% include components/todo.html title="Experiment checklist" body=todo_body %}

</section>

---

<section class="ia-section" id="toggles" markdown="1">
  <div class="ia-section__header">
    <h2>Toggles</h2>
  </div>

  {% capture toggles_body %}
  <details>
    <summary><strong>Assumptions</strong></summary>

    - i.i.d. data
    - bounded gradients
  </details>

  <details>
    <summary><strong>Implementation notes</strong></summary>

    Use mixed precision and fuse layernorm where possible.

    <details>
      <summary><strong>Nested - micro-optimizations</strong></summary>

      - fuse bias + activation
      - avoid unnecessary casts
    </details>
  </details>
  {% endcapture %}
  {% include components/toggles.html title="Appendix" body=toggles_body %}

</section>

---

<section class="ia-section" id="figures" markdown="1">
  <div class="ia-section__header">
    <h2>Figures</h2>
  </div>

Click to zoom into a lightbox; Escape or click outside dismisses.

  {% include components/figure.html
     src="/assets/images/smile-emoji.svg"
     alt="smiling emoji"
     width="180"
     caption="A local SVG emoji image (click to zoom)."
  %}

### File links

Attach downloads inline: {% include components/file.html href="/assets/files/Janaki_Resume.pdf" label="Download PDF" %}

</section>

---

<section class="ia-section" id="marginfig" markdown="1">
  <div class="ia-section__header">
    <h2>Margin figure</h2>
  </div>

A small diagram that belongs in the right gutter on desktop and stacks inline on mobile - useful when a figure is supporting, not central.

  {% include components/marginfig.html
     src="/assets/images/smile-emoji.svg"
     alt="smiling emoji"
     caption="Emoji image in the gutter on desktop; inline on mobile."
  %}

This paragraph continues flowing in the main column while the figure sits alongside. Good for architecture diagrams that illustrate a single paragraph's point, small plots, or icon-sized schematics.

</section>

---

<section class="ia-section" id="sidebyside" markdown="1">
  <div class="ia-section__header">
    <h2>Side-by-side</h2>
  </div>

Two columns for before/after, input→output, or alternative formulations. Collapses to a stack below 900px.

{% capture sbs_left %}
```python
# imperative
total = 0
for x in xs:
    total += x * x
```
{% endcapture %}

{% capture sbs_right %}
```python
# vectorised
total = (xs * xs).sum()
```
{% endcapture %}

{% include components/sidebyside.html
   left=sbs_left right=sbs_right
   left_title="Loop" right_title="NumPy" %}

</section>

---

<section class="ia-section" id="math" markdown="1">
  <div class="ia-section__header">
    <h2>Math</h2>
  </div>

Inline: $C_{ij}=\sum_k A_{ik}B_{kj}$.

Block:

$$
\mathrm{FLOPs} \approx 2MNK
$$
</section>

---

<section class="ia-section" id="stepper" markdown="1">
  <div class="ia-section__header">
    <h2>Stepper</h2>
  </div>

Discrete steps - good for derivations, ablations, or walk-throughs.

<div class="ia-stepper" data-stepper>
  <div class="ia-stepper__controls"></div>
  <div class="ia-stepper__panel" data-step markdown="1">

**Step 1.** Start with a simple recurrence.

$$ a_{t} = \alpha\, a_{t-1} + x_t $$

  </div>
  <div class="ia-stepper__panel" data-step markdown="1" hidden>

**Step 2.** Each new token updates state.

The running average of past inputs is a linear combination governed by $\alpha$.

  </div>
  <div class="ia-stepper__panel" data-step markdown="1" hidden>

**Step 3.** Later outputs depend on stored information.

This is the essence of any recurrent model - the state is the memory.

  </div>
</div>

</section>

---

<section class="ia-section" id="tables" markdown="1">
  <div class="ia-section__header">
    <h2>Tables</h2>
  </div>

| Component       | Type    | Notes                                      |
|-----------------|---------|--------------------------------------------|
| Callout         | block   | `info` / `tip` / `warn` / `danger`         |
| Sidenote        | layout  | Margin on desktop, inline on mobile        |
| Tooltip         | inline  | Hover / focus bubble                       |
| Citation        | inline  | Same bubble, with a link                   |
| Tabs            | block   | Arrow keys navigate                        |
| Code + copy     | inline  | Hover a `<pre>` to reveal copy             |
| Mermaid         | diagram | Rendered client-side                       |
| Statement       | block   | Definition / theorem / proof               |
| Quote           | block   | Pull quote w/ attribution                  |
| Checklist       | block   | Strikes completed items                    |
| Toggles         | block   | Nestable `<details>`                       |
| Figure          | block   | Click to zoom                              |
| Margin figure   | layout  | Small figure in gutter                     |
| Side-by-side    | block   | 2-column, stacks below 900px               |
| Stepper         | widget  | Prev/Next panels                           |

</section>

---

<section class="ia-section" id="references" markdown="1">
  <div class="ia-section__header">
    <h2>References</h2>
  </div>

1. [Distill.pub - explorable explanations and interactive technical storytelling](https://distill.pub/)

</section>
