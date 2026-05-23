'use strict';

const fs   = require('fs');
const path = require('path');
const { parse } = require('csv-parse/sync');
const { normalizeAsset, normalizeType } = require('../matching/aliases');

// ── Required columns ─────────────────────────────────────────────────────────
const REQUIRED_COLUMNS = ['transaction_id', 'timestamp', 'type', 'asset', 'quantity'];

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Attempt to parse a timestamp string.  Returns a Date if valid, null otherwise.
 *
 * @param {string} raw
 * @returns {Date|null}
 */
function parseTimestamp(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  const d = new Date(trimmed);
  // new Date('2024-03-09T') returns a valid date in some runtimes → guard
  if (isNaN(d.getTime())) return null;
  // Reject incomplete ISO strings (missing time component entirely)
  if (!/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(trimmed)) return null;
  return d;
}

/**
 * Parse and validate a single row from either CSV source.
 *
 * Returns:
 *   { row: <normalised object>, issues: [] }   – valid row (issues may contain warnings)
 *   { row: <raw object>,        issues: [...] } – flagged row; issues describes what's wrong
 *
 * A flagged row is NEVER silently dropped – it is stored with its issues.
 *
 * @param {object} raw         Raw CSV record (key → string)
 * @param {string} source      'user' | 'exchange'
 * @param {number} lineNumber  1-based line number in the file (for diagnostics)
 * @param {Set}    seenIds     Set of transaction_id values seen so far in this file
 * @returns {{ row: object, issues: string[], valid: boolean }}
 */
function validateRow(raw, source, lineNumber, seenIds) {
  const issues   = [];
  let   isValid  = true;

  // ── 1. Missing required columns ──────────────────────────────────────────
  for (const col of REQUIRED_COLUMNS) {
    const val = raw[col];
    if (val === undefined || val === null || String(val).trim() === '') {
      // 'type' being null is flagged but we still keep the row
      issues.push(`Missing required field: "${col}"`);
      if (col !== 'type') isValid = false; // missing type alone → warn, not invalid
    }
  }

  // ── 2. Duplicate transaction_id within the same source file ─────────────
  const txId = String(raw.transaction_id ?? '').trim();
  if (txId && seenIds.has(txId)) {
    issues.push(`Duplicate transaction_id "${txId}" in ${source} file`);
    isValid = false;
  } else if (txId) {
    seenIds.add(txId);
  }

  // ── 3. Timestamp validation ──────────────────────────────────────────────
  const parsedTs = parseTimestamp(raw.timestamp);
  if (!parsedTs) {
    issues.push(`Unparseable timestamp: "${raw.timestamp}"`);
    isValid = false;
  }

  // ── 4. Quantity validation ───────────────────────────────────────────────
  const qty = parseFloat(raw.quantity);
  if (isNaN(qty)) {
    issues.push(`Non-numeric quantity: "${raw.quantity}"`);
    isValid = false;
  } else if (qty < 0) {
    issues.push(`Negative quantity: ${qty} — likely a data entry error`);
    isValid = false;
  } else if (qty === 0) {
    issues.push(`Zero quantity — transaction has no economic effect`);
    // zero is unusual but not necessarily fatal
  }

  // ── 5. Price sanity (optional field) ────────────────────────────────────
  const price = parseFloat(raw.price_usd);
  if (raw.price_usd !== undefined && raw.price_usd !== '' && isNaN(price)) {
    issues.push(`Non-numeric price_usd: "${raw.price_usd}"`);
  }

  // ── 6. Normalise ─────────────────────────────────────────────────────────
  const normalisedRow = {
    // Preserve originals for the report
    _raw: { ...raw },
    _source:     source,
    _lineNumber: lineNumber,
    _issues:     issues,
    _valid:      isValid,

    transaction_id: txId,
    timestamp_raw:  String(raw.timestamp ?? '').trim(),
    timestamp:      parsedTs,          // Date | null
    type:           normalizeType(raw.type),
    type_raw:       String(raw.type ?? '').trim(),
    asset:          normalizeAsset(raw.asset),
    asset_raw:      String(raw.asset ?? '').trim(),
    quantity:       isNaN(qty) ? null : qty,
    price_usd:      isNaN(price) ? null : price,
    fee:            parseFloat(raw.fee) || null,
    note:           String(raw.note ?? '').trim() || null,
  };

  return { row: normalisedRow, issues, valid: isValid };
}

/**
 * Parse a CSV file and return an ingestion result object.
 *
 * @param {string} filePath   Absolute path to the CSV file
 * @param {string} source     'user' | 'exchange'
 * @returns {{
 *   valid:   object[],   // rows that passed all validations
 *   flagged: object[],   // rows with quality issues (NOT dropped)
 *   columns: string[],
 *   totalRows: number,
 * }}
 */
function parseCSV(filePath, source) {
  const raw = fs.readFileSync(filePath, 'utf8');

  let records;
  try {
    records = parse(raw, {
      columns:          true,
      skip_empty_lines: true,
      trim:             true,
      relax_column_count: true,  // tolerate rows with extra/missing columns
    });
  } catch (err) {
    throw new Error(`Failed to parse ${source} CSV (${path.basename(filePath)}): ${err.message}`);
  }

  if (records.length === 0) {
    return { valid: [], flagged: [], columns: [], totalRows: 0 };
  }

  const columns = Object.keys(records[0]);

  // Check for missing required columns at the file level
  const missingCols = REQUIRED_COLUMNS.filter(c => !columns.includes(c));
  if (missingCols.length > 0) {
    throw new Error(
      `${source} CSV is missing required columns: ${missingCols.join(', ')}`
    );
  }

  const valid   = [];
  const flagged = [];
  const seenIds = new Set();

  records.forEach((record, idx) => {
    const lineNumber = idx + 2; // +2 = 1 for header + 1-based
    const { row, valid: isValid } = validateRow(record, source, lineNumber, seenIds);
    if (isValid) {
      valid.push(row);
    } else {
      flagged.push(row);
    }
  });

  return {
    valid,
    flagged,
    columns,
    totalRows: records.length,
  };
}

module.exports = { parseCSV };
