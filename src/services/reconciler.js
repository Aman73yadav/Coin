'use strict';

const path        = require('path');
const { v4: uuid }= require('uuid');

const { getConfig }           = require('../config');
const { parseCSV }            = require('../ingestion/parser');
const { matchTransactions, CATEGORIES } = require('../matching/engine');
const { buildSummary, resultsToCsv, flaggedToCsv, flattenRow } = require('../reporting/generator');
const { db }                  = require('../db');

/**
 * Run a full reconciliation:
 *  1. Parse + validate both CSVs
 *  2. Store all rows in DB (valid + flagged)
 *  3. Run the matching engine
 *  4. Persist results
 *  5. Return a run summary
 *
 * @param {string} userFilePath      Absolute path to user CSV
 * @param {string} exchangeFilePath  Absolute path to exchange CSV
 * @param {object} [configOverrides] Per-request tolerance overrides
 * @returns {Promise<object>}        Run metadata + summary
 */
async function runReconciliation(userFilePath, exchangeFilePath, configOverrides = {}) {
  const runId    = uuid();
  const cfg      = getConfig(configOverrides);
  const startedAt = new Date().toISOString();

  // ── Record the run ──────────────────────────────────────────────────────
  await db().createRun({
    runId,
    startedAt,
    completedAt:    null,
    status:         'running',
    config:         cfg,
    userFile:       path.basename(userFilePath),
    exchangeFile:   path.basename(exchangeFilePath),
    summary:        null,
  });

  try {
    // ── 1. Ingest ─────────────────────────────────────────────────────────
    console.log(`[${runId}] Parsing user CSV…`);
    const userIngestion = parseCSV(userFilePath, 'user');
    console.log(
      `[${runId}] User CSV: ${userIngestion.totalRows} total rows, ` +
      `${userIngestion.valid.length} valid, ${userIngestion.flagged.length} flagged`
    );

    console.log(`[${runId}] Parsing exchange CSV…`);
    const excIngestion = parseCSV(exchangeFilePath, 'exchange');
    console.log(
      `[${runId}] Exchange CSV: ${excIngestion.totalRows} total rows, ` +
      `${excIngestion.valid.length} valid, ${excIngestion.flagged.length} flagged`
    );

    // Log flagged rows prominently
    if (userIngestion.flagged.length > 0) {
      console.warn(`[${runId}] ⚠  ${userIngestion.flagged.length} flagged USER rows:`);
      for (const r of userIngestion.flagged) {
        console.warn(`  Line ${r._lineNumber} (${r.transaction_id}): ${r._issues.join(' | ')}`);
      }
    }
    if (excIngestion.flagged.length > 0) {
      console.warn(`[${runId}] ⚠  ${excIngestion.flagged.length} flagged EXCHANGE rows:`);
      for (const r of excIngestion.flagged) {
        console.warn(`  Line ${r._lineNumber} (${r.transaction_id}): ${r._issues.join(' | ')}`);
      }
    }

    // ── 2. Store raw rows ─────────────────────────────────────────────────
    const allUserRows = [
      ...userIngestion.valid.map(r   => ({ ...r, _runId: runId })),
      ...userIngestion.flagged.map(r => ({ ...r, _runId: runId })),
    ];
    const allExcRows = [
      ...excIngestion.valid.map(r   => ({ ...r, _runId: runId })),
      ...excIngestion.flagged.map(r => ({ ...r, _runId: runId })),
    ];
    await db().insertRawRows(runId, [...allUserRows, ...allExcRows]);

    // ── 3. Match ──────────────────────────────────────────────────────────
    console.log(`[${runId}] Running matching engine…`);
    const results = matchTransactions(
      userIngestion.valid,
      excIngestion.valid,
      cfg
    );
    console.log(`[${runId}] Matching complete: ${results.length} result records`);

    // ── 4. Persist results ────────────────────────────────────────────────
    const resultDocs = results.map(r => ({
      category:    r.category,
      reason:      r.reason,
      user_row:    r.user_row    ? serializeRow(r.user_row)    : null,
      exchange_row: r.exchange_row ? serializeRow(r.exchange_row) : null,
    }));
    await db().insertResults(runId, resultDocs);

    // ── 5. Summary ────────────────────────────────────────────────────────
    const summary = buildSummary(
      results,
      userIngestion.flagged,
      excIngestion.flagged
    );

    const completedAt = new Date().toISOString();
    await db().updateRun(runId, { completedAt, status: 'completed', summary });

    console.log(`[${runId}] Done. Summary:`, summary);

    return { runId, startedAt, completedAt, status: 'completed', config: cfg, summary };

  } catch (err) {
    await db().updateRun(runId, {
      completedAt: new Date().toISOString(),
      status:      'failed',
      error:       err.message,
    });
    throw err;
  }
}

/**
 * Serialise a normalised row for storage (convert Date → ISO string, drop internal fields).
 */
function serializeRow(row) {
  return {
    transaction_id: row.transaction_id,
    timestamp:      row.timestamp ? row.timestamp.toISOString() : null,
    timestamp_raw:  row.timestamp_raw,
    type:           row.type,
    type_raw:       row.type_raw,
    asset:          row.asset,
    asset_raw:      row.asset_raw,
    quantity:       row.quantity,
    price_usd:      row.price_usd,
    fee:            row.fee,
    note:           row.note,
    _source:        row._source,
    _lineNumber:    row._lineNumber,
    _issues:        row._issues,
    _valid:         row._valid,
  };
}

module.exports = { runReconciliation };
