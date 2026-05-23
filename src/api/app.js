'use strict';

const express = require('express');
const routes  = require('./routes');

function createApp() {
  const app = express();

  // ── Middleware ──────────────────────────────────────────────────────────
  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));

  // Request logger
  app.use((req, _res, next) => {
    console.log(`[http] ${req.method} ${req.path}`);
    next();
  });

  // ── Routes ──────────────────────────────────────────────────────────────
  app.use('/', routes);

  // ── Error handler ───────────────────────────────────────────────────────
  app.use((err, _req, res, _next) => {
    console.error('[app] Unhandled error:', err);
    res.status(500).json({ error: err.message ?? 'Internal server error' });
  });

  return app;
}

module.exports = { createApp };
