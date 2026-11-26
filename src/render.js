'use strict';

const fs = require('fs');
const path = require('path');

const TEMPLATE = path.join(__dirname, 'template.html');

/**
 * Serialize for embedding inside a <script> element. JSON is not automatically
 * safe there: a literal "</script>" in any prompt would close the tag early,
 * and U+2028/U+2029 are valid JSON but illegal in JS string literals.
 */
function safeJson(value) {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

/** The shape the page expects, built once so the file and the server agree. */
function payloadFor(sessions, meta = {}) {
  return {
    sessions,
    meta: {
      builtAt: Date.now(),
      from: sessions.reduce((m, s) => Math.min(m, s.start || Infinity), Infinity),
      to: sessions.reduce((m, s) => Math.max(m, s.end || 0), 0),
      ...meta,
    },
  };
}

function render(sessions, meta = {}) {
  const template = fs.readFileSync(TEMPLATE, 'utf8');
  const script = `<script>window.__LEDGER__ = ${safeJson(payloadFor(sessions, meta))};</script>`;

  if (!template.includes('<!--DATA-->')) {
    throw new Error('template.html is missing its <!--DATA--> placeholder');
  }
  // A function replacer is required, not a string: transcripts are full of shell
  // snippets, and `$\`` / `$'` / `$&` in a replacement string are substitution
  // patterns that would splice parts of the page back into the JSON payload.
  return template.replace('<!--DATA-->', () => script);
}

module.exports = { render, payloadFor, safeJson };
