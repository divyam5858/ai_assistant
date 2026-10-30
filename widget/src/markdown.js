/**
 * Safe and lightweight Markdown parser for assistant responses.
 * Escapes raw HTML first to prevent any XSS attacks,
 * then formats standard markdown constructs (code blocks, bold, lists, links, etc.).
 */

export function escapeHtml(str) {
  if (typeof str !== 'string') return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function parseMarkdown(text) {
  if (!text) return '';

  // Filter out action code blocks from standard markdown formatting
  const textWithoutAction = text.replace(/```(?:action:hirepool|action)\s*\n[\s\S]*?\n```/gi, '').trim();

  // Step 1: Escape all raw HTML
  let md = escapeHtml(textWithoutAction);

  // Step 2: Code blocks with copy button
  md = md.replace(/```([a-zA-Z0-9_-]*)\n([\s\S]*?)```/g, (match, lang, code) => {
    const langLabel = lang ? `<span class="code-lang">${lang}</span>` : '';
    return `<div class="code-block-wrapper">
      <div class="code-header">
        ${langLabel}
        <button class="copy-code-btn" type="button" aria-label="Copy code block">Copy</button>
      </div>
      <pre><code>${code.trim()}</code></pre>
    </div>`;
  });

  // Step 3: Inline code
  md = md.replace(/`([^`\n]+)`/g, '<code class="inline-code">$1</code>');

  // Step 4: Headers
  md = md.replace(/^### (.*$)/gim, '<h4>$1</h4>');
  md = md.replace(/^## (.*$)/gim, '<h3>$1</h3>');
  md = md.replace(/^# (.*$)/gim, '<h2>$1</h2>');

  // Step 5: Bold and Italic
  md = md.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  md = md.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  md = md.replace(/__([^_]+)__/g, '<strong>$1</strong>');
  md = md.replace(/_([^_]+)_/g, '<em>$1</em>');

  // Step 6: Blockquotes
  md = md.replace(/^\> (.*$)/gim, '<blockquote>$1</blockquote>');

  // Step 7: Unordered lists
  md = md.replace(/^\s*[-*+]\s+(.*)$/gim, '<li>$1</li>');
  md = md.replace(/(<li>.*<\/li>)/gims, (match) => {
    // Only wrap consecutive li items if not inside pre
    return `<ul>${match}</ul>`;
  });
  // Clean up nested adjacent uls
  md = md.replace(/<\/ul>\s*<ul>/g, '');

  // Step 8: Links (sanitized with target and rel)
  md = md.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');

  // Step 9: Paragraphs and line breaks
  // Convert double newlines to paragraph breaks
  const paragraphs = md.split(/\n{2,}/);
  const formatted = paragraphs.map(p => {
    const trimmed = p.trim();
    if (!trimmed) return '';
    // Don't wrap in <p> if it starts with block element
    if (/^<(h[1-4]|div|pre|ul|ol|blockquote)/i.test(trimmed)) {
      return trimmed;
    }
    return `<p>${trimmed.replace(/\n/g, '<br/>')}</p>`;
  }).filter(Boolean).join('');

  return formatted;
}
