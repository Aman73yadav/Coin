'use strict';

/**
 * In-memory store that mirrors the MongoDB Mongoose interface used by the
 * rest of the application.  Swap this module out for the MongoDB driver
 * (src/db/mongodb.js) by changing DB_DRIVER in config.
 *
 * Collections:
 *   runs       – one document per /reconcile invocation
 *   results    – N documents per run (one per matched/unmatched/conflicting row)
 *   raw_rows   – all ingested rows (valid + flagged) per run
 */

// ── Internal store ───────────────────────────────────────────────────────────
const store = {
  runs:     new Map(),   // runId → run doc
  results:  new Map(),   // runId → result doc[]
  raw_rows: new Map(),   // runId → rawRow doc[]
};

// ── Runs ─────────────────────────────────────────────────────────────────────

async function createRun(doc) {
  store.runs.set(doc.runId, { ...doc });
  return doc;
}

async function getRun(runId) {
  return store.runs.get(runId) ?? null;
}

async function updateRun(runId, update) {
  const existing = store.runs.get(runId);
  if (!existing) return null;
  const updated = { ...existing, ...update };
  store.runs.set(runId, updated);
  return updated;
}

// ── Results ──────────────────────────────────────────────────────────────────

async function insertResults(runId, docs) {
  if (!store.results.has(runId)) store.results.set(runId, []);
  store.results.get(runId).push(...docs);
}

async function getResults(runId) {
  return store.results.get(runId) ?? [];
}

async function getResultsByCategory(runId, categories) {
  const all = store.results.get(runId) ?? [];
  if (!categories || categories.length === 0) return all;
  const set = new Set(categories);
  return all.filter(r => set.has(r.category));
}

// ── Raw rows ─────────────────────────────────────────────────────────────────

async function insertRawRows(runId, docs) {
  if (!store.raw_rows.has(runId)) store.raw_rows.set(runId, []);
  store.raw_rows.get(runId).push(...docs);
}

async function getRawRows(runId) {
  return store.raw_rows.get(runId) ?? [];
}

// ── Lifecycle ────────────────────────────────────────────────────────────────

async function connect() {
  // Nothing to do for in-memory
  console.log('[db] Using in-memory store (no MongoDB required)');
}

async function disconnect() {
  // Nothing to do
}

module.exports = {
  connect, disconnect,
  createRun, getRun, updateRun,
  insertResults, getResults, getResultsByCategory,
  insertRawRows, getRawRows,
};
