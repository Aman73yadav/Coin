'use strict';

require('dotenv').config();

const { initDB }    = require('./db');
const { createApp } = require('./api/app');
const { getBase }   = require('./config');

async function main() {
  // ── 1. Connect to DB ────────────────────────────────────────────────────
  await initDB();

  // ── 2. Start HTTP server ────────────────────────────────────────────────
  const { PORT } = getBase();
  const app      = createApp();

  app.listen(PORT, () => {
    console.log(`\n🚀  Reconciliation Engine running on http://localhost:${PORT}`);
    console.log('');
    console.log('  Endpoints:');
    console.log(`    POST  http://localhost:${PORT}/reconcile`);
    console.log(`    GET   http://localhost:${PORT}/report/:runId`);
    console.log(`    GET   http://localhost:${PORT}/report/:runId/summary`);
    console.log(`    GET   http://localhost:${PORT}/report/:runId/unmatched`);
    console.log(`    GET   http://localhost:${PORT}/report/:runId/flagged`);
    console.log('');
    console.log('  Quick start:');
    console.log(`    curl -X POST http://localhost:${PORT}/reconcile`);
    console.log('');
  });
}

main().catch(err => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});
