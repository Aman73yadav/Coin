'use strict';

/**
 * Asset alias map – keys are lowercase aliases, values are canonical symbols.
 * Extend this map to handle new aliases without code changes.
 */
const ASSET_ALIASES = {
  bitcoin:      'BTC',
  btc:          'BTC',
  ethereum:     'ETH',
  eth:          'ETH',
  solana:       'SOL',
  sol:          'SOL',
  tether:       'USDT',
  usdt:         'USDT',
  polygon:      'MATIC',
  matic:        'MATIC',
  chainlink:    'LINK',
  link:         'LINK',
};

/**
 * Normalise an asset symbol to its canonical upper-case form.
 * Returns the original (upper-cased) if no alias is found.
 *
 * @param {string|null|undefined} raw
 * @returns {string}
 */
function normalizeAsset(raw) {
  if (!raw || typeof raw !== 'string') return '';
  const lower = raw.trim().toLowerCase();
  return ASSET_ALIASES[lower] ?? raw.trim().toUpperCase();
}

// ── Transaction type mapping ─────────────────────────────────────────────────
/**
 * Some transaction types are the same economic event seen from opposite
 * perspectives:
 *
 *   Exchange records TRANSFER_IN  ←→  User records TRANSFER_OUT
 *   (exchange received funds)         (user sent funds)
 *
 * This map lists types that are "perspective flips" of each other.
 * Both directions are stored for O(1) lookup.
 */
const PERSPECTIVE_FLIP_PAIRS = [
  ['TRANSFER_IN',  'TRANSFER_OUT'],
  ['DEPOSIT',      'WITHDRAWAL'],
];

const FLIP_MAP = new Map();
for (const [a, b] of PERSPECTIVE_FLIP_PAIRS) {
  FLIP_MAP.set(a.toUpperCase(), b.toUpperCase());
  FLIP_MAP.set(b.toUpperCase(), a.toUpperCase());
}

/**
 * Normalise a transaction type to upper-case.
 *
 * @param {string|null|undefined} raw
 * @returns {string}
 */
function normalizeType(raw) {
  if (!raw || typeof raw !== 'string') return '';
  return raw.trim().toUpperCase();
}

/**
 * Returns true if typeA and typeB represent the same economic event,
 * accounting for perspective flips.
 *
 * @param {string} typeA  (already normalised)
 * @param {string} typeB  (already normalised)
 * @returns {boolean}
 */
function typesMatch(typeA, typeB) {
  if (typeA === typeB) return true;
  // Check if they are perspective flips of each other
  return FLIP_MAP.get(typeA) === typeB;
}

module.exports = { normalizeAsset, normalizeType, typesMatch };
