const INLINE_MARKERS = [
  { marker: '***', type: 'strong-emphasis' },
  { marker: '**', type: 'strong' },
  { marker: '~~', type: 'strikethrough' },
  { marker: '*', type: 'emphasis' },
];

function appendText(nodes, value) {
  if (!value) return;
  const previous = nodes.at(-1);
  if (previous?.type === 'text') previous.value += value;
  else nodes.push({ type: 'text', value });
}

function safeHttpsUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}

function closingMarkerIndex(source, marker, contentStart) {
  if (marker !== '*') return source.indexOf(marker, contentStart);

  for (let index = contentStart; index < source.length; index += 1) {
    if (!source.startsWith('*', index)) continue;
    if (!source.startsWith('**', index)) return index;

    const nestedBoldEnd = source.indexOf('**', index + 2);
    if (nestedBoldEnd <= index + 2) return index;
    index = nestedBoldEnd + 1;
  }

  return -1;
}

export function parseLightweightInline(value = '') {
  const source = String(value);
  const nodes = [];
  let index = 0;

  while (index < source.length) {
    if (source[index] === '[' && source[index - 1] !== '!') {
      const link = source.slice(index).match(/^\[([^\]\r\n]+)\]\((https:\/\/[^\s<>\r\n)]+)\)/i);
      const href = link && safeHttpsUrl(link[2]);
      if (link && href) {
        nodes.push({ type: 'link', href, children: parseLightweightInline(link[1]) });
        index += link[0].length;
        continue;
      }
    }

    const format = INLINE_MARKERS.find(({ marker }) => source.startsWith(marker, index));
    if (format) {
      const contentStart = index + format.marker.length;
      const contentEnd = closingMarkerIndex(source, format.marker, contentStart);
      if (contentEnd > contentStart) {
        nodes.push({
          type: format.type,
          children: parseLightweightInline(source.slice(contentStart, contentEnd)),
        });
        index = contentEnd + format.marker.length;
        continue;
      }
    }

    appendText(nodes, source[index]);
    index += 1;
  }

  return nodes;
}

function paragraph(lines) {
  return {
    type: 'paragraph',
    children: parseLightweightInline(lines.join(' ')),
  };
}

export function parseLightweightMarkdown(value = '') {
  const lines = String(value).replace(/\r\n?/g, '\n').split('\n');
  const blocks = [];
  let paragraphLines = [];

  const flushParagraph = () => {
    if (!paragraphLines.length) return;
    blocks.push(paragraph(paragraphLines));
    paragraphLines = [];
  };

  for (let index = 0; index < lines.length;) {
    const line = lines[index];
    if (!line.trim()) {
      flushParagraph();
      index += 1;
      continue;
    }

    const bullet = line.match(/^- (.+)$/);
    if (bullet) {
      flushParagraph();
      const items = [];
      while (index < lines.length) {
        const match = lines[index].match(/^- (.+)$/);
        if (!match) break;
        items.push(parseLightweightInline(match[1]));
        index += 1;
      }
      blocks.push({ type: 'bullet-list', items });
      continue;
    }

    const numbered = line.match(/^(\d+)\. (.+)$/);
    if (numbered) {
      flushParagraph();
      const start = Number(numbered[1]);
      const items = [];
      while (index < lines.length) {
        const match = lines[index].match(/^\d+\. (.+)$/);
        if (!match) break;
        items.push(parseLightweightInline(match[1]));
        index += 1;
      }
      blocks.push({ type: 'numbered-list', start, items });
      continue;
    }

    const quote = line.match(/^> (.+)$/);
    if (quote) {
      flushParagraph();
      const quoteLines = [];
      while (index < lines.length) {
        const match = lines[index].match(/^> (.+)$/);
        if (!match) break;
        quoteLines.push(match[1]);
        index += 1;
      }
      blocks.push({ type: 'blockquote', children: parseLightweightInline(quoteLines.join(' ')) });
      continue;
    }

    paragraphLines.push(line);
    index += 1;
  }

  flushParagraph();
  return blocks;
}
