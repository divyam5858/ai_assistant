import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { parseMarkdown, escapeHtml } from '../widget/src/markdown.js';

describe('Markdown Parser & HTML Sanitizer', () => {
  test('escapeHtml escapes dangerous HTML characters', () => {
    const raw = '<script>alert("XSS")</script>&"\'';
    const escaped = escapeHtml(raw);
    assert.ok(!escaped.includes('<script>'));
    assert.ok(escaped.includes('&lt;script&gt;'));
    assert.ok(escaped.includes('&amp;'));
    assert.ok(escaped.includes('&quot;'));
    assert.ok(escaped.includes('&#39;'));
  });

  test('formats code blocks with language and copy button', () => {
    const md = '```javascript\nconst x = 42;\n```';
    const html = parseMarkdown(md);
    assert.ok(html.includes('code-block-wrapper'));
    assert.ok(html.includes('<span class="code-lang">javascript</span>'));
    assert.ok(html.includes('const x = 42;'));
    assert.ok(html.includes('copy-code-btn'));
  });

  test('formats inline code', () => {
    const md = 'Use `console.log()` to debug.';
    const html = parseMarkdown(md);
    assert.ok(html.includes('<code class="inline-code">console.log()</code>'));
  });

  test('formats bold and italics', () => {
    const md = 'This is **bold** and this is *italic*.';
    const html = parseMarkdown(md);
    assert.ok(html.includes('<strong>bold</strong>'));
    assert.ok(html.includes('<em>italic</em>'));
  });

  test('formats unordered list items', () => {
    const md = '- Item 1\n- Item 2\n- Item 3';
    const html = parseMarkdown(md);
    assert.ok(html.includes('<li>Item 1</li>'));
    assert.ok(html.includes('<li>Item 2</li>'));
    assert.ok(html.includes('<ul>'));
  });

  test('formats links safely with rel="noopener noreferrer"', () => {
    const md = '[Google](https://google.com)';
    const html = parseMarkdown(md);
    assert.ok(html.includes('href="https://google.com"'));
    assert.ok(html.includes('target="_blank"'));
    assert.ok(html.includes('rel="noopener noreferrer"'));
  });

  test('escapes HTML tags embedded inside user messages', () => {
    const malicious = 'Hello <img src="x" onerror="alert(1)"/> world';
    const html = parseMarkdown(malicious);
    assert.ok(!html.includes('<img'));
    assert.ok(html.includes('&lt;img'));
  });
});

