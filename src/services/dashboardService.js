'use strict';

const { pool } = require('../config/db');

async function dailySummary() {
  const [rows] = await pool.query('SELECT * FROM v_daily_transaction_summary ORDER BY txn_date DESC');
  return rows;
}

async function overallStats() {
  const [[txn]] = await pool.query(
    `SELECT
        COUNT(*)                                        AS total_transactions,
        COALESCE(SUM(amount), 0)                        AS total_volume,
        SUM(status IN ('flagged','quarantined'))        AS flagged_transactions,
        SUM(status = 'quarantined')                     AS quarantined_transactions,
        ROUND(100 * SUM(status IN ('flagged','quarantined')) / GREATEST(COUNT(*),1), 2) AS flagged_ratio_pct
       FROM transactions`
  );
  const [[acct]] = await pool.query(
    `SELECT
        COUNT(*)                                  AS total_accounts,
        COALESCE(SUM(balance), 0)                 AS total_balances,
        SUM(status = 'frozen')                    AS frozen_accounts
       FROM accounts`
  );
  const [[cust]] = await pool.query(
    'SELECT COUNT(*) AS total_customers, ROUND(AVG(risk_score),2) AS avg_risk FROM customers'
  );
  const [[rings]] = await pool.query('SELECT COUNT(*) AS device_rings FROM v_fraud_ring_devices');
  return { transactions: txn, accounts: acct, customers: cust, deviceRings: rings.device_rings };
}

async function auditTrail({ limit = 100 } = {}) {
  const [rows] = await pool.query('SELECT * FROM v_recent_audit LIMIT ?', [Number(limit)]);
  return rows;
}

async function merchantSettlement(merchantId = null) {
  if (merchantId) {
    const [rows] = await pool.query('SELECT * FROM v_merchant_settlement WHERE merchant_id = ?', [merchantId]);
    return rows;
  }
  const [rows] = await pool.query('SELECT * FROM v_merchant_settlement');
  return rows;
}

module.exports = { dailySummary, overallStats, auditTrail, merchantSettlement };
