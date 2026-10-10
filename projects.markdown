---
layout: default
title: Projects
permalink: /projects/
---

<div class="projects-page">
  <h1>Projects</h1>

  {%- assign date_format = "%b %-d, %Y" -%}
  <ul class="post-list">
    {%- assign visible_projects = site.data.projects | where_exp: "project", "project.published != false" -%}
    {%- for project in visible_projects -%}
      <li>
        <span class="post-meta">{{ project.date | date: date_format }}</span>
        <h3>
          <a class="post-link" href="{{ project.url | relative_url }}">{{ project.title | escape }}</a>
        </h3>
        {%- if project.description -%}
          <div class="post-meta">{{ project.description }}</div>
        {%- endif -%}
      </li>
    {%- endfor -%}
  </ul>
</div>
