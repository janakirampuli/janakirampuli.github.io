---
layout: default
title: Programming GPUs from scratch
permalink: /projects/gpu-programming/
published: true
---

<div class="projects-page">
  <h1>Programming GPUs from scratch</h1>

  <p>How GPUs work, and CUDA and Triton kernels written from scratch.</p>

  {%- comment -%} Notes join this page with `project: gpu-programming` and `part: N` in front matter. {%- endcomment -%}
  {%- assign parts = site.notes | where: "project", "gpu-programming" | where_exp: "n", "n.published != false" | sort: "part" -%}
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
