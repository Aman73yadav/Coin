'use strict';

/**
 * Configuration management.
 *
 * Resolution order (highest → lowest priority):
 *   1. Per-request overrides passed to /reconcile body
 *   2. Environment variables
 *   3. config.json next to this file
 *   4. Hard-coded defaults below
 */

const fs = require('fs');
const path = require('path');

// ── Hard-coded defaults ──────────────────────────────────────────────────────
const DEFAULTS = {
  // How far apart two timestamps can be (in seconds) and still be considered a match
  TIMESTAMP_TOLERANCE_SECONDS: 300,          // 5 minutes

  // Maximum relative difference in quantity to still count as a match (0.01 = 1%)
  QUANTITY_TOLERANCE_PCT: 0.01,

  // MongoDB connection string (used when DB_DRIVER === 'mongodb')
  MONGODB_URI: 'mongodb://localhost:27017/reconciliation',

  // 'mongodb' | 'memory'  – use 'memory' when Mongo is not available
  DB_DRIVER: 'memory',

  // TCP port the Express server listens on
  PORT: 3000,
};

// ── Load optional config.json ────────────────────────────────────────────────
let fileConfig = {};
const configFilePath = path.join(__dirname, '..', 'config.json');
if (fs.existsSync(configFilePath)) {
  try {
    fileConfig = JSON.parse(fs.readFileSync(configFilePath, 'utf8'));
  } catch (err) {
    console.warn(`[config] Failed to parse config.json: ${err.message}`);
  }
}

// ── Merge: defaults < file < env ─────────────────────────────────────────────
function getBase() {
  return {
    TIMESTAMP_TOLERANCE_SECONDS: Number(
      process.env.TIMESTAMP_TOLERANCE_SECONDS
        ?? fileConfig.TIMESTAMP_TOLERANCE_SECONDS
        ?? DEFAULTS.TIMESTAMP_TOLERANCE_SECONDS
    ),
    QUANTITY_TOLERANCE_PCT: Number(
      process.env.QUANTITY_TOLERANCE_PCT
        ?? fileConfig.QUANTITY_TOLERANCE_PCT
        ?? DEFAULTS.QUANTITY_TOLERANCE_PCT
    ),
    MONGODB_URI:
      process.env.MONGODB_URI
      ?? fileConfig.MONGODB_URI
      ?? DEFAULTS.MONGODB_URI,
    DB_DRIVER:
      process.env.DB_DRIVER
      ?? fileConfig.DB_DRIVER
      ?? DEFAULTS.DB_DRIVER,
    PORT: Number(
      process.env.PORT
        ?? fileConfig.PORT
        ?? DEFAULTS.PORT
    ),
  };
}

/**
 * Merge base config with optional per-request overrides.
 * Only tolerance keys are overridable per-request.
 *
 * @param {object} [overrides={}]
 * @returns {object}
 */
function getConfig(overrides = {}) {
  const base = getBase();
  return {
    ...base,
    TIMESTAMP_TOLERANCE_SECONDS:
      overrides.TIMESTAMP_TOLERANCE_SECONDS !== undefined
        ? Number(overrides.TIMESTAMP_TOLERANCE_SECONDS)
        : base.TIMESTAMP_TOLERANCE_SECONDS,
    QUANTITY_TOLERANCE_PCT:
      overrides.QUANTITY_TOLERANCE_PCT !== undefined
        ? Number(overrides.QUANTITY_TOLERANCE_PCT)
        : base.QUANTITY_TOLERANCE_PCT,
  };
}

module.exports = { getConfig, getBase };
