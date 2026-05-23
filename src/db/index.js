'use strict';

const { getBase } = require('../config');

let _db = null;

/**
 * Returns the active DB driver singleton.
 * Must be initialised via initDB() before use.
 */
function db() {
  if (!_db) throw new Error('DB not initialised. Call initDB() first.');
  return _db;
}

/**
 * Initialise the database connection based on DB_DRIVER config.
 * Idempotent – safe to call multiple times.
 */
async function initDB() {
  if (_db) return _db;

  const { DB_DRIVER } = getBase();
  const driver = DB_DRIVER?.toLowerCase();

  if (driver === 'mongodb') {
    try {
      _db = require('./mongodb');
      await _db.connect();
    } catch (err) {
      console.warn(`[db] MongoDB connection failed (${err.message}). Falling back to in-memory store.`);
      _db = require('./memory');
      await _db.connect();
    }
  } else {
    _db = require('./memory');
    await _db.connect();
  }

  return _db;
}

module.exports = { db, initDB };
