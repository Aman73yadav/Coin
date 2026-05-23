'use strict';

const { stringify } = require('csv-stringify/sync');
const { CATEGORIES } = require('../matching/engine');

/**
 * Flatten a (possibly null) normalised row into plain report columns.
 * Prefixes each key so user and exchange columns are distinct.
 *
 * @param {object|null} row
 * @param {'user'|'exchange'} side
 * @returns {object}
 */
function flattenRow(row, side) {
  const p = side === 'user' ? 'user_' : 'exc_';
  if (!row) {
    return {
      [`${p}transaction_id`]: '',
      [`${p}timestamp`]:      '',
      [`${p}type`]:           '',
      [`${p}asset`]:          '',
      [`${p}quantity`]:       '',
      [`${p}price_usd`]:      '',
      [`${p}fee`]:            '',
      [`${p}note`]:           '',
    };
  }
  return {
    [`${p}transaction_id`]: row.transaction_id,
    [`${p}timestamp`]:      row.timestamp
      ? (row.timestamp instanceof Date ? row.timestamp.toISOString() : row.timestamp)
      : row.timestamp_raw,
    [`${p}type`]:           row.type_raw,
    [`${p}asset`]:          row.asset_raw,
    [`${p}quantity`]:       row.quantity ?? '',
    [`${p}price_usd`]:      row.price_usd ?? '',
    [`${p}fee`]:            row.fee ?? '',
    [`${p}note`]:           row.note ?? '',
  };
}

/**
 * Flatten a flagged (invalid) row for the data quality section.
 *
 * @param {object} row
 * @returns {object}
 */
function flattenFlaggedRow(row) {
  const raw = row._raw ?? {};
  return {
    source:         row._source,
    line_number:    row._lineNumber,
    transaction_id: row.transaction_id || raw.transaction_id || '',
    timestamp:      row.timestamp_raw || raw.timestamp || '',
    type:           row.type_raw || raw.type || '',
    asset:          row.asset_raw || raw.asset || '',
    quantity:       raw.quantity ?? '',
    price_usd:      raw.price_usd ?? '',
    fee:            raw.fee ?? '',
    note:           raw.note ?? '',
    issues:         (row._issues ?? []).join(' | '),
  };
}

/**
 * Convert an array of match results to a CSV string.
 *
 * @param {object[]} results  Match results from the engine
 * @returns {string}          CSV content
 */
function resultsToCsv(results) {
  if (results.length === 0) return '';

  const rows = results.map(r => ({
    category:                r.category,
    reason:                  r.reason,
    ...flattenRow(r.user_row,     'user'),
    ...flattenRow(r.exchange_row, 'exchange'),
  }));

  return stringify(rows, { header: true });
}

/**
 * Convert flagged rows to a CSV string.
 *
 * @param {object[]} flaggedRows
 * @returns {string}
 */
function flaggedToCsv(flaggedRows) {
  if (flaggedRows.length === 0) return '';
  const rows = flaggedRows.map(flattenFlaggedRow);
  return stringify(rows, { header: true });
}

/**
 * Build a summary object from results.
 *
 * @param {object[]} results
 * @param {object[]} flaggedUser
 * @param {object[]} flaggedExchange
 * @returns {object}
 */
function buildSummary(results, flaggedUser = [], flaggedExchange = []) {
  const counts = {
    [CATEGORIES.MATCHED]:            0,
    [CATEGORIES.CONFLICTING]:        0,
    [CATEGORIES.UNMATCHED_USER]:     0,
    [CATEGORIES.UNMATCHED_EXCHANGE]: 0,
  };
  for (const r of results) {
    if (counts[r.category] !== undefined) counts[r.category]++;
  }
  return {
    matched:            counts[CATEGORIES.MATCHED],
    conflicting:        counts[CATEGORIES.CONFLICTING],
    unmatched_user:     counts[CATEGORIES.UNMATCHED_USER],
    unmatched_exchange: counts[CATEGORIES.UNMATCHED_EXCHANGE],
    total_results:      results.length,
    flagged_user:       flaggedUser.length,
    flagged_exchange:   flaggedExchange.length,
    total_flagged:      flaggedUser.length + flaggedExchange.length,
  };
}

module.exports = { resultsToCsv, flaggedToCsv, buildSummary, flattenRow };
