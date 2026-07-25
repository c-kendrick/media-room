import React from 'react';
import { parseLightweightMarkdown } from './lightweight-markdown.js';

function InlineContent({ nodes }) {
  return nodes.map((node, index) => {
    const key = `${node.type}-${index}`;
    if (node.type === 'text') return <React.Fragment key={key}>{node.value}</React.Fragment>;
    if (node.type === 'strong') return <strong key={key}><InlineContent nodes={node.children} /></strong>;
    if (node.type === 'emphasis') return <em key={key}><InlineContent nodes={node.children} /></em>;
    if (node.type === 'strong-emphasis') return <strong key={key}><em><InlineContent nodes={node.children} /></em></strong>;
    if (node.type === 'strikethrough') return <del key={key}><InlineContent nodes={node.children} /></del>;
    if (node.type === 'link') return <a key={key} href={node.href} target="_blank" rel="noopener noreferrer"><InlineContent nodes={node.children} /></a>;
    return null;
  });
}

export function LightweightMarkdown({ className, children }) {
  const blocks = parseLightweightMarkdown(children);

  return (
    <div className={className}>
      {blocks.map((block, index) => {
        const key = `${block.type}-${index}`;
        if (block.type === 'paragraph') return <p key={key}><InlineContent nodes={block.children} /></p>;
        if (block.type === 'blockquote') return <blockquote key={key}><InlineContent nodes={block.children} /></blockquote>;
        if (block.type === 'bullet-list') {
          return <ul key={key}>{block.items.map((item, itemIndex) => <li key={itemIndex}><InlineContent nodes={item} /></li>)}</ul>;
        }
        if (block.type === 'numbered-list') {
          return <ol key={key} start={block.start}>{block.items.map((item, itemIndex) => <li key={itemIndex}><InlineContent nodes={item} /></li>)}</ol>;
        }
        return null;
      })}
    </div>
  );
}
