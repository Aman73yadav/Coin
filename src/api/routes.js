'use strict';

const express = require('express');
const path    = require('path');

const { runReconciliation }           = require('../services/reconciler');
const { db }                          = require('../db');
const { resultsToCsv, flaggedToCsv }  = require('../reporting/generator');
const { CATEGORIES }                  = require('../matching/engine');

const router = express.Router();

// ── Helpers ──────────────────────────────────────────────────────────────────

function notFound(res, entity, id) {
  return res.status(404).json({ error: `${entity} not found`, id });
}

function parseAccept(req) {
  const accept = req.headers.accept ?? '';
  return accept.includes('text/csv') ? 'csv' : 'json';
}

// ── Routes ───────────────────────────────────────────────────────────────────

/**
 * POST /reconcile
 *
 * Trigger a reconciliation run.
 * Accepts optional config overrides in the request body:
 *   { TIMESTAMP_TOLERANCE_SECONDS, QUANTITY_TOLERANCE_PCT }
 *
 * Optionally accepts file paths via body (for programmatic usage):
 *   { userFile, exchangeFile }
 * Defaults to the sample CSVs shipped with the engine.
 */
router.post('/reconcile', async (req, res) => {
  try {
    const {
      userFile,
      exchangeFile,
      TIMESTAMP_TOLERANCE_SECONDS,
      QUANTITY_TOLERANCE_PCT,
    } = req.body ?? {};

    // Resolve file paths.  Accept absolute or relative-to-project paths,
    // falling back to the bundled sample data.
    const projectRoot = path.join(__dirname, '..', '..');
    const userFilePath     = userFile
      ? path.resolve(userFile)
      : path.join(projectRoot, 'data', 'user_transactions.csv');
    const exchangeFilePath = exchangeFile
      ? path.resolve(exchangeFile)
      : path.join(projectRoot, 'data', 'exchange_transactions.csv');

    const overrides = {};
    if (TIMESTAMP_TOLERANCE_SECONDS !== undefined) {
      overrides.TIMESTAMP_TOLERANCE_SECONDS = Number(TIMESTAMP_TOLERANCE_SECONDS);
    }
    if (QUANTITY_TOLERANCE_PCT !== undefined) {
      overrides.QUANTITY_TOLERANCE_PCT = Number(QUANTITY_TOLERANCE_PCT);
    }

    const result = await runReconciliation(userFilePath, exchangeFilePath, overrides);

    return res.status(202).json(result);
  } catch (err) {
    console.error('[POST /reconcile]', err);
    return res.status(500).json({ error: err.message });
  }
});

// ── /report/:runId ───────────────────────────────────────────────────────────

/**
 * GET /report/:runId
 *
 * Returns the full reconciliation report.
 * Responds with JSON by default; set Accept: text/csv for CSV output.
 *
 * Optional query params:
 *   ?category=MATCHED,CONFLICTING  – filter by category
 */
router.get('/report/:runId', async (req, res) => {
  const { runId } = req.params;
  const run = await db().getRun(runId);
  if (!run) return notFound(res, 'Run', runId);

  const categoryFilter = req.query.category
    ? req.query.category.split(',').map(c => c.trim().toUpperCase())
    : [];

  const results   = await db().getResultsByCategory(runId, categoryFilter);
  const rawRows   = await db().getRawRows(runId);
  const flagged   = rawRows.filter(r => !r._valid);

  if (parseAccept(req) === 'csv') {
    const csv = resultsToCsv(results);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="report_${runId}.csv"`);
    return res.send(csv);
  }

  return res.json({
    runId,
    status:    run.status,
    config:    run.config,
    summary:   run.summary,
    results,
    data_quality: {
      flagged_rows: flagged,
    },
  });
});

/**
 * GET /report/:runId/summary
 *
 * Returns just the counts: matched, conflicting, unmatched.
 */
router.get('/report/:runId/summary', async (req, res) => {
  const { runId } = req.params;
  const run = await db().getRun(runId);
  if (!run) return notFound(res, 'Run', runId);

  return res.json({
    runId,
    status:      run.status,
    completedAt: run.completedAt,
    config:      run.config,
    summary:     run.summary,
  });
});

/**
 * GET /report/:runId/unmatched
 *
 * Returns only unmatched rows (UNMATCHED_USER + UNMATCHED_EXCHANGE)
 * with reasons.  Set Accept: text/csv for CSV output.
 */
router.get('/report/:runId/unmatched', async (req, res) => {
  const { runId } = req.params;
  const run = await db().getRun(runId);
  if (!run) return notFound(res, 'Run', runId);

  const unmatchedCategories = [
    CATEGORIES.UNMATCHED_USER,
    CATEGORIES.UNMATCHED_EXCHANGE,
  ];
  const results = await db().getResultsByCategory(runId, unmatchedCategories);

  if (parseAccept(req) === 'csv') {
    const csv = resultsToCsv(results);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="unmatched_${runId}.csv"`);
    return res.send(csv);
  }

  return res.json({
    runId,
    unmatched_count: results.length,
    results,
  });
});

/**
 * GET /report/:runId/flagged
 *
 * Returns rows that failed data quality checks (not in matched/unmatched –
 * these are rows excluded from matching entirely due to fatal parse errors).
 * Set Accept: text/csv for CSV output.
 */
router.get('/report/:runId/flagged', async (req, res) => {
  const { runId } = req.params;
  const run = await db().getRun(runId);
  if (!run) return notFound(res, 'Run', runId);

  const rawRows = await db().getRawRows(runId);
  const flagged = rawRows.filter(r => !r._valid);

  if (parseAccept(req) === 'csv') {
    const csv = flaggedToCsv(flagged);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="flagged_${runId}.csv"`);
    return res.send(csv);
  }

  return res.json({
    runId,
    flagged_count: flagged.length,
    flagged_rows:  flagged,
  });
});

/**
 * GET /health
 * Simple liveness check.
 */
router.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

module.exports = router;
