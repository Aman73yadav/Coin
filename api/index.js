'use strict';

require('dotenv').config();

const { initDB }    = require('../src/db');
const { createApp } = require('../src/api/app');

let app = null;

module.exports = async (req, res) => {
  if (!app) {
    await initDB();
    app = createApp();
  }
  return app(req, res);
};
