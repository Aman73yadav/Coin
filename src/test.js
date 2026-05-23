'use strict';

/**
 * Standalone test / demo script.
 *
 * Runs the full reconciliation pipeline against the sample data and prints
 * a detailed report to stdout.  No HTTP server required.
 *
 * Usage:
 *   node src/test.js
 *   node src/test.js --strict          (tighten tolerances)
 *   node src/test.js --loose           (loosen tolerances)
 */

const path = require('path');
const fs   = require('fs');

process.chdir(path.join(__dirname, '..'));

const { initDB }            = require('./db');
const { runReconciliation } = require('./services/reconciler');
const { db }                = require('./db');
const { CATEGORIES }        = require('./matching/engine');
const { resultsToCsv, flaggedToCsv } = require('./reporting/generator');

// ── Parse CLI flags ──────────────────────────────────────────────────────────
const args    = process.argv.slice(2);
const isLoose  = args.includes('--loose');
const isStrict = args.includes('--strict');

const overrides = isLoose
  ? { TIMESTAMP_TOLERANCE_SECONDS: 600, QUANTITY_TOLERANCE_PCT: 0.05 }
  : isStrict
    ? { TIMESTAMP_TOLERANCE_SECONDS: 30,  QUANTITY_TOLERANCE_PCT: 0.001 }
    : {};

const DATA_DIR       = path.join(__dirname, '..', 'data');
const USER_FILE      = path.join(DATA_DIR, 'user_transactions.csv');
const EXCHANGE_FILE  = path.join(DATA_DIR, 'exchange_transactions.csv');
const OUTPUT_DIR     = path.join(__dirname, '..', 'output');

// ── Helpers ──────────────────────────────────────────────────────────────────
const hr  = (char = '─', n = 72) => char.repeat(n);
const box = (title) => {
  console.log('\n' + hr('═'));
  console.log(`  ${title}`);
  console.log(hr('═'));
};

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log(hr());
  console.log('  Crypto Transaction Reconciliation Engine — Test Run');
  console.log(hr());
  if (isLoose)  console.log('  Mode: LOOSE tolerances (±600s, ±5%)');
  if (isStrict) console.log('  Mode: STRICT tolerances (±30s, ±0.1%)');
  if (!isLoose && !isStrict) console.log('  Mode: DEFAULT tolerances (±300s, ±0.01%)');
  console.log();

  // Boot DB
  await initDB();

  // Run reconciliation
  const run = await runReconciliation(USER_FILE, EXCHANGE_FILE, overrides);

  console.log(`\n  Run ID : ${run.runId}`);
  console.log(`  Status : ${run.status}`);
  console.log(`  Config : TIMESTAMP_TOLERANCE_SECONDS=${run.config.TIMESTAMP_TOLERANCE_SECONDS}, QUANTITY_TOLERANCE_PCT=${run.config.QUANTITY_TOLERANCE_PCT}`);

  // ── Summary ───────────────────────────────────────────────────────────────
  box('SUMMARY');
  const s = run.summary;
  console.log(`  Matched            : ${s.matched}`);
  console.log(`  Conflicting        : ${s.conflicting}`);
  console.log(`  Unmatched (User)   : ${s.unmatched_user}`);
  console.log(`  Unmatched (Exch.)  : ${s.unmatched_exchange}`);
  console.log(`  ` + hr('-', 30));
  console.log(`  Total results      : ${s.total_results}`);
  console.log(`  Flagged rows       : ${s.total_flagged} (${s.flagged_user} user, ${s.flagged_exchange} exchange)`);

  // ── Detailed results ──────────────────────────────────────────────────────
  const results = await db().getResults(run.runId);

  for (const cat of Object.values(CATEGORIES)) {
    const rows = results.filter(r => r.category === cat);
    if (rows.length === 0) continue;

    box(`${cat} (${rows.length})`);

    for (const r of rows) {
      const usr = r.user_row;
      const exc = r.exchange_row;

      console.log(`  Reason : ${r.reason}`);
      if (usr) {
        console.log(`  User   : [${usr.transaction_id}] ${usr.timestamp?.slice(0,19)} | ${usr.type_raw.padEnd(12)} | ${usr.asset_raw.padEnd(6)} | qty=${usr.quantity}`);
      }
      if (exc) {
        console.log(`  Exch.  : [${exc.transaction_id}] ${exc.timestamp?.slice(0,19)} | ${exc.type_raw.padEnd(12)} | ${exc.asset_raw.padEnd(6)} | qty=${exc.quantity}`);
      }
      console.log(`  ` + hr('-', 68));
    }
  }

  // ── Flagged rows ──────────────────────────────────────────────────────────
  const rawRows = await db().getRawRows(run.runId);
  const flagged = rawRows.filter(r => !r._valid);

  if (flagged.length > 0) {
    box(`DATA QUALITY ISSUES (${flagged.length} flagged rows)`);
    for (const r of flagged) {
      console.log(`  [${r._source.toUpperCase()}] Line ${r._lineNumber} | ${r.transaction_id || '(no id)'}`);
      for (const issue of r._issues) {
        console.log(`    ⚠  ${issue}`);
      }
      console.log();
    }
  }

  // ── Write CSV outputs ─────────────────────────────────────────────────────
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const reportCsv  = resultsToCsv(results);
  const flaggedCsv = flaggedToCsv(flagged);

  const reportPath  = path.join(OUTPUT_DIR, `reconciliation_report_${run.runId.slice(0,8)}.csv`);
  const flaggedPath = path.join(OUTPUT_DIR, `data_quality_${run.runId.slice(0,8)}.csv`);

  fs.writeFileSync(reportPath, reportCsv, 'utf8');
  fs.writeFileSync(flaggedPath, flaggedCsv, 'utf8');

  box('OUTPUT FILES');
  console.log(`  Reconciliation report : ${reportPath}`);
  console.log(`  Data quality report   : ${flaggedPath}`);
  console.log();
}

main().catch(err => {
  console.error('\n❌  Test failed:', err.message);
  console.error(err.stack);
  process.exit(1);
});
