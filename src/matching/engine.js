'use strict';

const { typesMatch } = require('./aliases');

/**
 * ══════════════════════════════════════════════════════════════════════════════
 *  Matching Engine
 *  ──────────────────────────────────────────────────────────────────────────
 *  Pairs user transactions with exchange transactions using a configurable
 *  tolerance for timestamp and quantity.
 *
 *  Matching strategy (in priority order):
 *
 *  Phase 1 – Exact ID cross-reference
 *    Some exchanges embed user IDs in notes or vice-versa.  This phase is a
 *    no-op in the current dataset but is included as an extension point.
 *
 *  Phase 2 – Proximity matching
 *    For each user transaction, find all exchange candidates where:
 *      • asset matches (normalised, case-insensitive)
 *      • type matches (including perspective flips)
 *      • |Δt| ≤ TIMESTAMP_TOLERANCE_SECONDS
 *      • |Δqty| / max(qty) ≤ QUANTITY_TOLERANCE_PCT
 *
 *    Among candidates, pick the one with the smallest |Δt|.
 *    If any candidate exists but ALL are outside tolerance → CONFLICTING.
 *
 *  Phase 3 – Classify leftovers
 *    Unmatched user rows    → UNMATCHED_USER
 *    Unmatched exchange rows → UNMATCHED_EXCHANGE
 * ══════════════════════════════════════════════════════════════════════════════
 */

// ── Constants ────────────────────────────────────────────────────────────────
const CATEGORIES = Object.freeze({
  MATCHED:            'MATCHED',
  CONFLICTING:        'CONFLICTING',
  UNMATCHED_USER:     'UNMATCHED_USER',
  UNMATCHED_EXCHANGE: 'UNMATCHED_EXCHANGE',
});

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Absolute timestamp difference in seconds between two rows.
 * Returns Infinity if either timestamp is null.
 */
function timeDeltaSeconds(rowA, rowB) {
  if (!rowA.timestamp || !rowB.timestamp) return Infinity;
  return Math.abs(rowA.timestamp.getTime() - rowB.timestamp.getTime()) / 1000;
}

/**
 * Relative quantity difference as a fraction.
 * Returns Infinity if either quantity is null.
 *
 * We use max(|qtyA|, |qtyB|) as denominator so that near-zero quantities
 * don't produce spurious large percentages.
 */
function quantityDelta(rowA, rowB) {
  if (rowA.quantity == null || rowB.quantity == null) return Infinity;
  const denom = Math.max(Math.abs(rowA.quantity), Math.abs(rowB.quantity));
  if (denom === 0) return 0; // both zero → no difference
  return Math.abs(rowA.quantity - rowB.quantity) / denom;
}

/**
 * Build a human-readable explanation for why two rows were matched or why
 * they are conflicting.
 */
function buildReason(userRow, excRow, cfg, withinTolerance) {
  const dt  = timeDeltaSeconds(userRow, excRow);
  const dq  = quantityDelta(userRow, excRow);
  const dqPct = (dq * 100).toFixed(4);

  const parts = [];

  if (userRow.type !== excRow.type) {
    parts.push(`type perspective flip (${userRow.type} ↔ ${excRow.type})`);
  }
  if (userRow.asset_raw.toLowerCase() !== excRow.asset_raw.toLowerCase()) {
    parts.push(`asset alias resolved (${userRow.asset_raw} → ${userRow.asset})`);
  }

  if (!withinTolerance) {
    const conflicts = [];
    if (dt > cfg.TIMESTAMP_TOLERANCE_SECONDS) {
      conflicts.push(`timestamp Δ=${dt.toFixed(0)}s exceeds ±${cfg.TIMESTAMP_TOLERANCE_SECONDS}s`);
    }
    if (dq > cfg.QUANTITY_TOLERANCE_PCT) {
      conflicts.push(`quantity Δ=${dqPct}% exceeds ±${(cfg.QUANTITY_TOLERANCE_PCT * 100).toFixed(4)}%`);
    }
    return `Proximity conflict — ${conflicts.join('; ')}${parts.length ? ' | Notes: ' + parts.join(', ') : ''}`;
  }

  const matchDetails = [];
  if (dt === 0) {
    matchDetails.push('exact timestamp');
  } else {
    matchDetails.push(`timestamp Δ=${dt.toFixed(0)}s`);
  }
  if (dq === 0) {
    matchDetails.push('exact quantity');
  } else {
    matchDetails.push(`quantity Δ=${dqPct}%`);
  }
  return `Matched — ${matchDetails.join(', ')}${parts.length ? ' | Notes: ' + parts.join(', ') : ''}`;
}

// ── Main matching function ───────────────────────────────────────────────────

/**
 * Match user transactions against exchange transactions.
 *
 * @param {object[]} userRows      Valid (parsed & normalised) user rows
 * @param {object[]} exchangeRows  Valid (parsed & normalised) exchange rows
 * @param {object}   cfg           Config object (TIMESTAMP_TOLERANCE_SECONDS, QUANTITY_TOLERANCE_PCT)
 *
 * @returns {object[]}  Array of result objects, each containing:
 *   {
 *     category,
 *     reason,
 *     user_row,      // null for UNMATCHED_EXCHANGE
 *     exchange_row,  // null for UNMATCHED_USER
 *   }
 */
function matchTransactions(userRows, exchangeRows, cfg) {
  const results         = [];
  const usedExchangeIds = new Set(); // exchange rows already matched

  // ── Phase 1: Attempt cross-ID reference (extension point) ────────────────
  // In this dataset IDs are different schemas (USR-xxx vs EXC-xxx) so this
  // phase intentionally finds no matches.  If a future source embeds the
  // counterparty ID in notes, implement here.

  // ── Phase 2: Proximity matching ──────────────────────────────────────────
  for (const usr of userRows) {
    // Skip rows where we can't compute meaningful deltas
    if (!usr.timestamp || usr.quantity == null) {
      // Still track as unmatched – caller decides how to surface flagged rows
      results.push({
        category:     CATEGORIES.UNMATCHED_USER,
        reason:       'Cannot match: missing timestamp or quantity in user row',
        user_row:     usr,
        exchange_row: null,
      });
      continue;
    }

    // Collect ALL exchange candidates (same asset + compatible type)
    const candidates = exchangeRows
      .filter(exc => !usedExchangeIds.has(exc.transaction_id))
      .filter(exc => exc.asset === usr.asset)
      .filter(exc => typesMatch(usr.type, exc.type));

    if (candidates.length === 0) {
      results.push({
        category:     CATEGORIES.UNMATCHED_USER,
        reason:       `No exchange row with matching asset (${usr.asset}) and compatible type (${usr.type})`,
        user_row:     usr,
        exchange_row: null,
      });
      continue;
    }

    // From candidates, find those within both tolerances
    const withinTolerance = candidates.filter(exc => {
      const dt = timeDeltaSeconds(usr, exc);
      const dq = quantityDelta(usr, exc);
      return dt <= cfg.TIMESTAMP_TOLERANCE_SECONDS
          && dq <= cfg.QUANTITY_TOLERANCE_PCT;
    });

    if (withinTolerance.length > 0) {
      // Best match = smallest timestamp delta
      const best = withinTolerance.reduce((a, b) =>
        timeDeltaSeconds(usr, a) <= timeDeltaSeconds(usr, b) ? a : b
      );
      usedExchangeIds.add(best.transaction_id);
      results.push({
        category:     CATEGORIES.MATCHED,
        reason:       buildReason(usr, best, cfg, true),
        user_row:     usr,
        exchange_row: best,
      });
      continue;
    }

    // Candidates exist but none within tolerance → CONFLICTING
    // Pick the closest one (smallest combined delta) for the report
    const closest = candidates.reduce((a, b) => {
      const scoreA = timeDeltaSeconds(usr, a) + quantityDelta(usr, a) * 1_000_000;
      const scoreB = timeDeltaSeconds(usr, b) + quantityDelta(usr, b) * 1_000_000;
      return scoreA <= scoreB ? a : b;
    });

    // Mark as used so it doesn't also appear as UNMATCHED_EXCHANGE
    usedExchangeIds.add(closest.transaction_id);

    results.push({
      category:     CATEGORIES.CONFLICTING,
      reason:       buildReason(usr, closest, cfg, false),
      user_row:     usr,
      exchange_row: closest,
    });
  }

  // ── Phase 3: Unmatched exchange rows ─────────────────────────────────────
  for (const exc of exchangeRows) {
    if (!usedExchangeIds.has(exc.transaction_id)) {
      results.push({
        category:     CATEGORIES.UNMATCHED_EXCHANGE,
        reason:       `No user row with matching asset (${exc.asset}) and compatible type (${exc.type}) within tolerance`,
        user_row:     null,
        exchange_row: exc,
      });
    }
  }

  return results;
}

module.exports = { matchTransactions, CATEGORIES };
