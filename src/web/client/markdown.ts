// @ts-nocheck
// Shared tiny markdown renderer for trusted UI surfaces that still need HTML escaping.
// Supports the existing message subset only: headings, paragraphs, lists, fenced code,
// inline code, links, bold, and emphasis.
export function renderSafeMarkdownHtml(value, esc) {
  const fence = String.fromCharCode(96).repeat(3);
  const lines = String(value || '').replace(/\r\n/g, '\n').split('\n');
  const out = [];
  let paragraph = [];
  let listType = '';
  let listItems = [];
  let inCode = false;
  let codeLines = [];
  function flushParagraph() {
    if (!paragraph.length) return;
    out.push('<p>' + paragraph.map((item) => renderMarkdownInline(item, esc)).join('<br>') + '</p>');
    paragraph = [];
  }
  function flushList() {
    if (!listType || !listItems.length) return;
    out.push('<' + listType + '>' + listItems.map((item) => '<li>' + renderMarkdownInline(item, esc) + '</li>').join('') + '</' + listType + '>');
    listType = '';
    listItems = [];
  }
  function flushCode() {
    if (!codeLines.length) return;
    out.push('<pre><code>' + esc(codeLines.join('\n')) + '</code></pre>');
    codeLines = [];
  }
  for (const line of lines) {
    if (line.trim().startsWith(fence)) {
      if (inCode) { flushCode(); inCode = false; }
      else { flushParagraph(); flushList(); inCode = true; codeLines = []; }
      continue;
    }
    if (inCode) { codeLines.push(line); continue; }
    if (!line.trim()) { flushParagraph(); flushList(); continue; }
    const bullet = line.match(/^\s*[-*]\s+(.+)$/);
    const numbered = line.match(/^\s*\d+[.)]\s+(.+)$/);
    if (bullet) {
      flushParagraph();
      if (listType && listType !== 'ul') flushList();
      listType = 'ul';
      listItems.push(bullet[1]);
      continue;
    }
    if (numbered) {
      flushParagraph();
      if (listType && listType !== 'ol') flushList();
      listType = 'ol';
      listItems.push(numbered[1]);
      continue;
    }
    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      flushParagraph();
      flushList();
      const level = heading[1].length;
      out.push('<h' + level + '>' + renderMarkdownInline(heading[2], esc) + '</h' + level + '>');
      continue;
    }
    flushList();
    paragraph.push(line);
  }
  if (inCode) flushCode();
  flushParagraph();
  flushList();
  return out.join('') || '<p></p>';
}

export function renderMarkdownInline(value, esc) {
  const tick = String.fromCharCode(96);
  const codePattern = new RegExp(tick + '([^' + tick + ']+)' + tick, 'g');
  const codeSlots = [];
  const linkSlots = [];
  const marker = String.fromCharCode(0xe000);
  let text = String(value || '').replace(codePattern, (_, code) => {
    const token = marker + 'CODE' + codeSlots.length + marker;
    codeSlots.push('<code>' + esc(code) + '</code>');
    return token;
  });
  text = text.replace(/\[([^\]\n]{1,200})\]\((https?:\/\/[^\s)<>\"]{1,500})\)/g, (_, label, url) => {
    const token = marker + 'LINK' + linkSlots.length + marker;
    linkSlots.push('<a href="' + esc(url) + '" target="_blank" rel="noopener noreferrer">' + renderMarkdownInlineNoLinks(label, esc) + '</a>');
    return token;
  });
  text = esc(text)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>');
  codeSlots.forEach((html, index) => { text = text.replace(marker + 'CODE' + index + marker, html); });
  linkSlots.forEach((html, index) => { text = text.replace(marker + 'LINK' + index + marker, html); });
  return text;
}

export function renderMarkdownInlineNoLinks(value, esc) {
  return esc(String(value || ''))
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>');
}
