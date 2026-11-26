'use strict';

// Rates are USD per million tokens, first-party Anthropic API pricing.
// Cache multipliers: read = 0.1x input, 5m write = 1.25x input, 1h write = 2x input.
const RATES = {
  'claude-fable-5':   { in: 10, out: 50 },
  'claude-mythos-5':  { in: 10, out: 50 },
  'claude-opus-5':    { in: 5,  out: 25 },
  'claude-opus-4-8':  { in: 5,  out: 25 },
  'claude-opus-4-7':  { in: 5,  out: 25 },
  'claude-opus-4-6':  { in: 5,  out: 25 },
  'claude-sonnet-5':  { in: 3,  out: 15 },
  'claude-sonnet-4-6':{ in: 3,  out: 15 },
  'claude-haiku-4-5': { in: 1,  out: 5 },
};

// Sonnet 5 shipped with introductory pricing through 2026-08-31.
const SONNET5_INTRO = { in: 2, out: 10 };
const SONNET5_INTRO_UNTIL = Date.parse('2026-09-01T00:00:00Z');

// Fast mode (research preview) is billed at a premium on the Opus tier.
const FAST_RATES = { in: 10, out: 50 };

const CACHE_READ_MULT = 0.1;
const CACHE_WRITE_5M_MULT = 1.25;
const CACHE_WRITE_1H_MULT = 2.0;

function ratesFor(model, tsMs, speed) {
  if (!model || model === '<synthetic>') return null;
  if (speed === 'fast' && (model === 'claude-opus-5' || model === 'claude-opus-4-8')) {
    return FAST_RATES;
  }
  if (model === 'claude-sonnet-5' && tsMs && tsMs < SONNET5_INTRO_UNTIL) {
    return SONNET5_INTRO;
  }
  return RATES[model] || null;
}

/**
 * Cost in USD for one assistant response, from its raw `usage` block.
 * Unknown models cost 0 rather than guessing a rate.
 */
function costOf(usage, model, tsMs, speed) {
  const r = ratesFor(model, tsMs, speed);
  if (!r || !usage) return 0;
  const cc = usage.cache_creation || {};
  const w5 = cc.ephemeral_5m_input_tokens || 0;
  const w1 = cc.ephemeral_1h_input_tokens || 0;
  // Fall back to the flat field when the breakdown is absent (older transcripts).
  const flatWrite = (w5 + w1) ? 0 : (usage.cache_creation_input_tokens || 0);
  const M = 1e6;
  return (
    (usage.input_tokens || 0) * r.in / M +
    (usage.output_tokens || 0) * r.out / M +
    (usage.cache_read_input_tokens || 0) * r.in * CACHE_READ_MULT / M +
    (w5 + flatWrite) * r.in * CACHE_WRITE_5M_MULT / M +
    w1 * r.in * CACHE_WRITE_1H_MULT / M
  );
}

const KNOWN_MODELS = Object.keys(RATES);

module.exports = { costOf, ratesFor, RATES, KNOWN_MODELS };
