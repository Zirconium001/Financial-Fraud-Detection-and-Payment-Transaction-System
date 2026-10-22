'use strict';

const path = require('path');
const express = require('express');
const cors = require('cors');
const config = require('./config/env');
const { ping } = require('./config/db');
const { notFound, errorHandler } = require('./middleware/errorHandler');

const authRoutes = require('./routes/auth');
const accountRoutes = require('./routes/accounts');
const transactionRoutes = require('./routes/transactions');
const fraudRoutes = require('./routes/fraud');
const dashboardRoutes = require('./routes/dashboard');

const app = express();

app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

app.use(express.static(path.join(__dirname, '..', 'public')));

app.get('/api/health', async (req, res) => {
  try {
    await ping();
    res.json({ ok: true, status: 'healthy', database: 'connected', isolation: config.db.isolationLevel });
  } catch (err) {
    res.status(503).json({ ok: false, status: 'degraded', database: 'unreachable', error: err.message });
  }
});

app.use('/api/auth', authRoutes);
app.use('/api/accounts', accountRoutes);
app.use('/api/transactions', transactionRoutes);
app.use('/api/fraud', fraudRoutes);
app.use('/api/dashboard', dashboardRoutes);

app.use(notFound);
app.use(errorHandler);

async function start() {
  try {
    await ping();
    // eslint-disable-next-line no-console
    console.log(`[db] connected to ${config.db.host}:${config.db.port}/${config.db.database} (isolation: ${config.db.isolationLevel})`);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(`[db] WARNING: could not connect at startup -> ${err.message}`);
  }

  app.listen(config.port, () => {
    // eslint-disable-next-line no-console
    console.log(`[api] Fraud Detection API listening on http://localhost:${config.port}`);
  });
}

if (require.main === module) {
  start();
}

module.exports = app;
