'use strict';

const { pool, withTransaction } = require('../config/db');
const config = require('../config/env');
const { AppError } = require('../utils/errors');

async function listFlagged({ limit = 100, status } = {}) {
  const params = [];
  let sql = 'SELECT * FROM v_flagged_transactions';
  if (status) {
    sql += ' WHERE status = ?';
    params.push(status);
  }
  sql += ' LIMIT ?';
  params.push(Number(limit));
  const [rows] = await pool.query(sql, params);
  return rows;
}

async function listRules() {
  const [rows] = await pool.query(
    `SELECT rule_id, code, name, description, rule_type, metric,
            threshold, window_seconds, severity, weight, is_active
       FROM fraud_rules ORDER BY rule_id`
  );
  return rows;
}

async function ruleHitStats() {
  const [rows] = await pool.query('SELECT * FROM v_rule_hit_stats');
  return rows;
}

async function deviceRings() {
  const [rows] = await pool.query('SELECT * FROM v_fraud_ring_devices');
  return rows;
}

async function ipRings() {
  const [rows] = await pool.query('SELECT * FROM v_shared_ip_ring');
  return rows;
}

async function topRiskAccounts({ limit = 20 } = {}) {
  const [rows] = await pool.query('SELECT * FROM v_account_risk LIMIT ?', [Number(limit)]);
  return rows;
}

async function reverseTransaction(txnId, actorUserId) {
  return withTransaction(async (conn) => {
    await conn.query('CALL sp_reverse_transaction(?, ?)', [txnId, actorUserId]);
    const [rows] = await conn.query(
      `SELECT t.txn_id, t.status, t.amount, t.txn_type, a.balance
         FROM transactions t
         JOIN accounts a ON a.account_id = t.account_id
        WHERE t.txn_id = ?`,
      [txnId]
    );
    if (!rows.length) throw new AppError('Transaction not found', 404, 'NOT_FOUND');
    return rows[0];
  });
}

async function recomputeRisk() {
  await pool.query('CALL sp_recompute_all_risk()');
  return { ok: true };
}

async function blockAccount(accountId, actorUserId) {
  return withTransaction(async (conn) => {
    await conn.query('CALL sp_block_account(?, ?)', [accountId, actorUserId]);
    return fetchAccountState(conn, accountId);
  });
}

async function unblockAccount(accountId, actorUserId) {
  return withTransaction(async (conn) => {
    await conn.query('CALL sp_unblock_account(?, ?)', [accountId, actorUserId]);
    return fetchAccountState(conn, accountId);
  });
}

async function fetchAccountState(conn, accountId) {
  const [rows] = await conn.query(
    `SELECT a.account_id, a.account_number, a.status AS account_status,
            c.customer_id, c.is_blocked
       FROM accounts a
       JOIN customers c ON c.customer_id = a.customer_id
      WHERE a.account_id = ?`,
    [accountId]
  );
  if (!rows.length) throw new AppError('Account not found', 404, 'NOT_FOUND');
  return rows[0];
}

function procResultRows(out) {
  if (!Array.isArray(out)) return [];
  const nested = out.filter(Array.isArray);
  return nested.length ? nested[nested.length - 1] : out;
}

async function blockSuspicious({ threshold, actorUserId } = {}) {
  const parsed = Number(threshold);
  const effective = Number.isFinite(parsed) && parsed >= 0 && parsed <= 100
    ? parsed
    : config.fraud.flagThreshold;

  return withTransaction(async (conn) => {
    const [out] = await conn.query(
      'CALL sp_block_suspicious_accounts(?, ?)',
      [effective, actorUserId]
    );
    const rows = procResultRows(out);
    const summary = rows[0] || {};
    return {
      threshold: Number(summary.threshold != null ? summary.threshold : effective),
      accountsBlocked: Number(summary.accounts_blocked || 0),
      customersBlocked: Number(summary.customers_blocked || 0)
    };
  });
}

async function listBlacklist() {
  const [rows] = await pool.query('SELECT * FROM blacklist ORDER BY blacklist_id DESC');
  return rows;
}

async function addBlacklist({ entityType, entityValue, reason, severity = 'high' }) {
  const [result] = await pool.query(
    `INSERT INTO blacklist (entity_type, entity_value, reason, severity)
     VALUES (?, ?, ?, ?)`,
    [entityType, entityValue, reason, severity]
  );
  return { blacklistId: result.insertId };
}

module.exports = {
  listFlagged,
  listRules,
  ruleHitStats,
  deviceRings,
  ipRings,
  topRiskAccounts,
  reverseTransaction,
  recomputeRisk,
  blockAccount,
  unblockAccount,
  blockSuspicious,
  listBlacklist,
  addBlacklist
};
