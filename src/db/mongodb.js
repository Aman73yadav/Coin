'use strict';

/**
 * MongoDB driver.  Uses the native `mongodb` package (no Mongoose ODM
 * overhead) so the schema stays flexible – matching the document shape
 * produced by the reconciliation engine rather than enforcing a rigid model.
 *
 * Activated when DB_DRIVER=mongodb in config / environment.
 */

const { MongoClient } = require('mongodb');
const { getBase }     = require('../config');

let client;
let db;

async function connect() {
  const { MONGODB_URI } = getBase();
  client = new MongoClient(MONGODB_URI);
  await client.connect();
  db = client.db();
  console.log(`[db] Connected to MongoDB: ${MONGODB_URI}`);

  // Ensure indexes
  await db.collection('runs').createIndex({ runId: 1 }, { unique: true });
  await db.collection('results').createIndex({ runId: 1 });
  await db.collection('results').createIndex({ runId: 1, category: 1 });
  await db.collection('raw_rows').createIndex({ runId: 1 });
}

async function disconnect() {
  if (client) await client.close();
}

// ── Runs ─────────────────────────────────────────────────────────────────────

async function createRun(doc) {
  await db.collection('runs').insertOne(doc);
  return doc;
}

async function getRun(runId) {
  return db.collection('runs').findOne({ runId }, { projection: { _id: 0 } });
}

async function updateRun(runId, update) {
  const result = await db.collection('runs').findOneAndUpdate(
    { runId },
    { $set: update },
    { returnDocument: 'after', projection: { _id: 0 } }
  );
  return result?.value ?? result;
}

// ── Results ──────────────────────────────────────────────────────────────────

async function insertResults(runId, docs) {
  if (docs.length === 0) return;
  await db.collection('results').insertMany(docs.map(d => ({ runId, ...d })));
}

async function getResults(runId) {
  return db.collection('results')
    .find({ runId }, { projection: { _id: 0, runId: 0 } })
    .toArray();
}

async function getResultsByCategory(runId, categories) {
  const filter = categories?.length
    ? { runId, category: { $in: categories } }
    : { runId };
  return db.collection('results')
    .find(filter, { projection: { _id: 0, runId: 0 } })
    .toArray();
}

// ── Raw rows ─────────────────────────────────────────────────────────────────

async function insertRawRows(runId, docs) {
  if (docs.length === 0) return;
  await db.collection('raw_rows').insertMany(docs.map(d => ({ runId, ...d })));
}

async function getRawRows(runId) {
  return db.collection('raw_rows')
    .find({ runId }, { projection: { _id: 0, runId: 0 } })
    .toArray();
}

module.exports = {
  connect, disconnect,
  createRun, getRun, updateRun,
  insertResults, getResults, getResultsByCategory,
  insertRawRows, getRawRows,
};
