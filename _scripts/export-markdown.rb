# frozen_string_literal: true

# Writes plain Markdown copies of pages for AI agents, after `jekyll build`.
#
#   bundle exec ruby _scripts/export-markdown.rb _site
#
# 1. Every built HTML page that has <link rel="alternate" type="text/markdown">
#    (see _includes/markdown-url.html) gets a Markdown copy at that link's path.
#    The copy is made from the rendered page, so includes and Liquid are already
#    expanded. Interactive widgets are replaced by a one-line note.
# 2. llms-full.txt is llms.txt followed by every Markdown page it links to, in order.
#
# GitHub Pages builds in safe mode, which turns off custom plugins, so this runs
# as a separate step in .github/workflows/pages.yml.

require "nokogiri"
require "reverse_markdown"
require "uri"
require "yaml"

SITE_DIR = File.expand_path(ARGV.fetch(0, "_site"))

WIDGET_NOTE = "<p><em>[Interactive diagram. Open the HTML version of this page to use it.]</em></p>"

# Parts of the page that are only useful in a browser, and decorations such as logos.
DROP_SELECTORS = %w[script style svg canvas button input select textarea form .ia-toc [aria-hidden="true"]].freeze

def absolute(url, base)
  return url if url.nil? || url.empty? || url.start_with?("#", "mailto:", "data:")

  URI.join(base, url).to_s
rescue URI::Error
  url
end

def front_matter(meta)
  meta.compact.reject { |_, v| v.respond_to?(:empty?) && v.empty? }.to_yaml.strip + "\n---\n"
end

def page_meta(doc, main)
  canonical = doc.at('link[rel="canonical"]')&.[]("href")
  title = doc.at('meta[property="og:title"]')&.[]("content")
  date = doc.at('meta[property="article:published_time"]')&.[]("content")
  author = main.at("p.view")&.text&.sub(/\Aby\s+/, "")&.strip
  tags = main.at("small.tags")&.css("small")&.map { |t| t.text.strip.delete_suffix(",").strip }

  {
    "title" => title,
    "description" => doc.at('meta[name="description"]')&.[]("content"),
    "author" => author || doc.at('meta[name="author"]')&.[]("content"),
    "date" => date && date[0, 10],
    "tags" => tags,
    "url" => canonical,
  }
end

# The post and notes layouts print the date, title, author and tags around the
# content. They go into the front matter instead.
def remove_layout_chrome(main, title)
  main.css("small.date, p.view, small.tags").each(&:remove)
  first_h1 = main.at("h1")
  first_h1.remove if first_h1 && first_h1.text.strip == title.to_s.strip
end

def replace_widgets(main)
  # Widgets that draw with JavaScript ship a <noscript> fallback; swap the whole widget for a note.
  main.css("noscript").map(&:parent).uniq.each do |widget|
    widget.replace(Nokogiri::HTML::DocumentFragment.parse(WIDGET_NOTE))
  end
  # Links in the table of contents only jump within the HTML page.
  main.css(".ia-toc").each do |toc|
    heading = toc.previous_element
    heading.remove if heading&.name&.match?(/\Ah[1-6]\z/) && heading.text.strip == "Contents"
  end
  DROP_SELECTORS.each { |sel| main.css(sel).each(&:remove) }
end

# Citations: keep the link and put the hover text into the link title.
def convert_citations(main)
  main.css(".ia-cite-wrap").each do |wrap|
    link = wrap.at("a.ia-cite") || wrap.at(".ia-cite")
    bubble = wrap.at(".ia-cite__bubble")&.text&.strip
    if link&.name == "a"
      link["title"] = bubble if bubble && !bubble.empty?
      wrap.replace(link)
    else
      wrap.replace(Nokogiri::XML::Text.new([link&.text, bubble].compact.join(" "), main.document))
    end
  end
end

# Sidenotes become Markdown footnotes at the end of the page.
def convert_sidenotes(main, footnotes)
  main.css(".ia-sidenote").each do |note|
    label = note.at(".ia-sidenote__ref")&.text.to_s.strip
    key = label.gsub(/[^A-Za-z0-9_-]/, "")
    key = (footnotes.size + 1).to_s if key.empty? || footnotes.key?(key)
    body = note.at(".ia-sidenote__body")
    body&.at(".ia-sidenote__label")&.remove
    footnotes[key] = ReverseMarkdown.convert(body&.inner_html.to_s, github_flavored: true).strip.gsub(/\s*\n\s*/, " ")
    note.replace(Nokogiri::XML::Text.new("[^#{key}]", main.document))
  end
end

# The about page timeline is a list of cards. Give each card a heading.
def convert_timeline(main)
  main.css(".timeline__card").each do |card|
    title = card.at(".timeline__title") or next
    title.name = "h3"
    meta = card.at(".timeline__meta")
    title.add_next_sibling(meta) if meta
  end
end

# Rouge puts the language on a wrapper div; reverse_markdown looks for it on the <pre>'s parent.
def mark_code_languages(main)
  main.css("div.highlighter-rouge").each do |wrapper|
    lang = wrapper["class"].to_s[/language-([A-Za-z0-9]+)/, 1]
    pre = wrapper.at("pre")
    next unless lang && pre && lang != "plaintext"

    pre.parent["class"] = "#{pre.parent['class']} highlight-#{lang}".strip
  end
end

# reverse_markdown escapes _ and * in text, which breaks LaTeX. Swap math for
# placeholders before converting and put it back afterwards.
def protect_math(main, math)
  main.xpath(".//text()[not(ancestor::pre) and not(ancestor::code)]").each do |node|
    text = node.content
    next unless text.include?("\\(") || text.include?("\\[") || text.include?("$$")

    replaced = text.gsub(/\\\((.+?)\\\)|\\\[(.+?)\\\]|\$\$(.+?)\$\$/m) do
      inline, display, dollars = Regexp.last_match.captures
      math << (inline ? "$#{inline}$" : "$$#{display || dollars}$$")
      "MATHPLACEHOLDER#{math.size - 1}X"
    end
    node.content = replaced
  end
end

def absolutize_links(main, base)
  main.css("a[href]").each { |a| a["href"] = absolute(a["href"], base) }
  main.css("img[src]").each { |img| img["src"] = absolute(img["src"], base) }
end

# Indentation inside <div>s turns into a stray leading space on paragraphs.
# Remove it everywhere except in fenced code blocks.
def tidy(markdown)
  markdown.split(/(^```.*?^```$)/m).map.with_index do |part, i|
    i.odd? ? part : part.gsub(/^ (?=\S)/, "")
  end.join.gsub(/\n{3,}/, "\n\n").strip
end

def to_markdown(html_path)
  doc = Nokogiri::HTML(File.read(html_path))
  link = doc.at('link[rel="alternate"][type="text/markdown"]')
  main = doc.at("#main_content")
  return nil unless link && main

  meta = page_meta(doc, main)
  base = meta["url"] || "https://example.invalid/"
  footnotes = {}
  math = []

  remove_layout_chrome(main, meta["title"])
  replace_widgets(main)
  convert_citations(main)
  convert_sidenotes(main, footnotes)
  convert_timeline(main)
  mark_code_languages(main)
  protect_math(main, math)
  absolutize_links(main, base)

  body = ReverseMarkdown.convert(main.inner_html, github_flavored: true, unknown_tags: :bypass)
  body = body.gsub(/MATHPLACEHOLDER(\d+)X/) { math[Regexp.last_match(1).to_i] }
  body = tidy(body)

  out = +front_matter(meta)
  out << "\n# #{meta['title']}\n\n" if meta["title"]
  out << body << "\n"
  unless footnotes.empty?
    out << "\n"
    footnotes.each { |key, text| out << "[^#{key}]: #{text}\n" }
  end

  [URI(link["href"]).path, out]
end

written = {}
Dir.glob(File.join(SITE_DIR, "**", "*.html")).sort.each do |html_path|
  path, markdown = to_markdown(html_path)
  next unless path

  target = File.join(SITE_DIR, path)
  abort "#{html_path}: Markdown path #{path} is already taken" if written.key?(path)
  File.write(target, markdown)
  written[path] = markdown
end

llms_path = File.join(SITE_DIR, "llms.txt")
abort "llms.txt is missing from #{SITE_DIR}" unless File.exist?(llms_path)
llms = File.read(llms_path)

linked = llms.scan(/\]\((https?:\/\/[^)\s]+\.md)\)/).flatten.map { |u| URI(u).path }
missing = linked.reject { |p| written.key?(p) }
abort "llms.txt links to Markdown pages that were not written: #{missing.join(', ')}" unless missing.empty?

full = +llms.strip
linked.each { |p| full << "\n\n---\n\n" << written[p].strip }
File.write(File.join(SITE_DIR, "llms-full.txt"), full + "\n")

puts "Wrote #{written.size} Markdown pages and llms-full.txt (#{linked.size} pages, #{full.bytesize / 1024} KB)"
