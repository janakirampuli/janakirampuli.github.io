---
layout: default
title: Training an LLM from scratch
permalink: /projects/llm-from-scratch/
published: true
---

<div class="projects-page">
  <h1>Training an LLM from scratch</h1>

  <p>Notes, experiments and results from working through Stanford's <a href="https://cs336.stanford.edu/">CS336: Language Modeling from Scratch</a> (Spring 2026).</p>

  {%- comment -%} Notes join this page with `project: llm-from-scratch` and `part: N` in front matter. {%- endcomment -%}
  {%- assign parts = site.notes | where: "project", "llm-from-scratch" | where_exp: "n", "n.published != false" | sort: "part" -%}
  <ul class="post-list">
    {%- for note in parts -%}
      <li>
        <span class="post-meta">Part {{ note.part }}</span>
        <h3>
          <a class="post-link" href="{{ note.url | relative_url }}">{{ note.title | escape }}</a>
        </h3>
      </li>
    {%- endfor -%}
  </ul>
</div>
