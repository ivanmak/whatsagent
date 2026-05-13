// @ts-nocheck
// Shared tiny markdown renderer for trusted UI surfaces that still need HTML escaping.
// Supports the existing message subset only: headings, paragraphs, nested lists,
// fenced code, inline code, links, bold, and emphasis.
export function renderSafeMarkdownHtml(value, esc) {
  const fence = String.fromCharCode(96).repeat(3);
  const lines = String(value || '').replace(/\r\n/g, '\n').split('\n');
  const out = [];
  let paragraph = [];
  const listStack = [];
  let inCode = false;
  let codeLines = [];
  function flushParagraph() {
    if (!paragraph.length) return;
    out.push('<p>' + paragraph.map((item) => renderMarkdownInline(item, esc)).join('<br>') + '</p>');
    paragraph = [];
  }
  function indentColumns(raw) {
    let columns = 0;
    for (const char of raw) columns += char === '\t' ? 2 : 1;
    return columns;
  }
  function renderListFrame(frame) {
    return '<' + frame.type + '>' + frame.items.map((item) => {
      return '<li>' + renderMarkdownInline(item.text, esc) + item.children.map(renderListFrame).join('') + '</li>';
    }).join('') + '</' + frame.type + '>';
  }
  function flushList() {
    if (!listStack.length) return;
    out.push(renderListFrame(listStack[0]));
    listStack.length = 0;
  }
  function appendListItem(type, indent, text) {
    flushParagraph();
    function startRoot() {
      const frame = { type, indent, items: [] };
      listStack.push(frame);
      return frame;
    }
    let top = listStack[listStack.length - 1];
    if (!top) top = startRoot();
    while (listStack.length && indent < listStack[listStack.length - 1].indent) listStack.pop();
    top = listStack[listStack.length - 1];
    if (!top) top = startRoot();
    if (indent > top.indent) {
      const host = top.items[top.items.length - 1];
      if (host) {
        top = { type, indent, items: [] };
        host.children.push(top);
        listStack.push(top);
      }
    } else if (indent === top.indent && top.type !== type) {
      if (listStack.length === 1) {
        flushList();
        top = startRoot();
      } else {
        listStack.pop();
        const parent = listStack[listStack.length - 1];
        const host = parent.items[parent.items.length - 1];
        top = { type, indent, items: [] };
        if (host) host.children.push(top);
        listStack.push(top);
      }
    }
    top.items.push({ text, children: [] });
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
    const bullet = line.match(/^([ \t]*)[-*]\s+(.+)$/);
    const numbered = line.match(/^([ \t]*)\d+[.)]\s+(.+)$/);
    if (bullet) {
      appendListItem('ul', indentColumns(bullet[1]), bullet[2]);
      continue;
    }
    if (numbered) {
      appendListItem('ol', indentColumns(numbered[1]), numbered[2]);
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
