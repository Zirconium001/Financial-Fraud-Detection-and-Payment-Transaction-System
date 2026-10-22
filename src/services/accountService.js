'use strict';

const { pool } = require('../config/db');
const { AppError } = require('../utils/errors');

/**
 * List accounts visible to the caller.
 *  - customer : only their own accounts
 *  - merchant : none (they use settlement reporting)
 *  - analyst / admin : every account
 */
async function listAccounts(user) {
  const conn = pool;
  if (user.role === 'customer') {
    const [rows] = await conn.query(
      `SELECT a.account_id, a.account_number, a.account_type, a.currency,
              a.balance, a.status, a.opened_at, c.full_name, c.risk_score
         FROM accounts a
         JOIN customers c ON c.customer_id = a.customer_id
        WHERE a.customer_id = ?
        ORDER BY a.account_id`,
      [user.customerId]
    );
    return rows;
  }

  const [rows] = await conn.query(
    `SELECT a.account_id, a.account_number, a.account_type, a.currency,
            a.balance, a.status, a.opened_at, c.customer_id, c.full_name, c.risk_score
       FROM accounts a
       JOIN customers c ON c.customer_id = a.customer_id
      ORDER BY a.account_id`
  );
  return rows;
}

async function getAccount(user, accountId) {
  const [rows] = await pool.query(
    `SELECT a.*, c.full_name, c.risk_score, c.kyc_status
       FROM accounts a
       JOIN customers c ON c.customer_id = a.customer_id
      WHERE a.account_id = ?`,
    [accountId]
  );
  const account = rows[0];
  if (!account) throw new AppError('Account not found', 404, 'NOT_FOUND');

  if (user.role === 'customer' && account.customer_id !== user.customerId) {
    throw new AppError('You may only view your own accounts', 403, 'FORBIDDEN');
  }
  return account;
}

/**
 * Transaction history visible to the caller (with optional filters).
 */
async function listTransactions(user, { accountId, status, limit = 100 } = {}) {
  const where = [];
  const params = [];

  if (user.role === 'customer') {
    where.push('c.customer_id = ?');
    params.push(user.customerId);
  }
  if (accountId) {
    where.push('t.account_id = ?');
    params.push(accountId);
  }
  if (status) {
    where.push('t.status = ?');
    params.push(status);
  }

  const sql = `
    SELECT t.txn_id, t.txn_ref, t.created_at, t.txn_type, t.amount, t.currency,
           t.status, t.risk_score, a.account_number, a.account_id,
           c.full_name AS customer_name, m.name AS merchant_name,
           t.ip_address
      FROM transactions t
      JOIN accounts  a ON a.account_id = t.account_id
      JOIN customers c ON c.customer_id = a.customer_id
      LEFT JOIN merchants m ON m.merchant_id = t.merchant_id
     ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
     ORDER BY t.created_at DESC
     LIMIT ?`;
  params.push(Number(limit));

  const [rows] = await pool.query(sql, params);
  return rows;
}

async function getTransactionDetail(user, txnId) {
  const [rows] = await pool.query(
    `SELECT t.*, a.account_number, c.customer_id, c.full_name, m.name AS merchant_name,
            d.device_fingerprint
       FROM transactions t
       JOIN accounts  a ON a.account_id = t.account_id
       JOIN customers c ON c.customer_id = a.customer_id
       LEFT JOIN merchants m ON m.merchant_id = t.merchant_id
       LEFT JOIN devices   d ON d.device_id   = t.device_id
      WHERE t.txn_id = ?`,
    [txnId]
  );
  const txn = rows[0];
  if (!txn) throw new AppError('Transaction not found', 404, 'NOT_FOUND');
  if (user.role === 'customer' && txn.customer_id !== user.customerId) {
    throw new AppError('You may only view your own transactions', 403, 'FORBIDDEN');
  }

  const [hits] = await pool.query(
    `SELECT h.hit_id, h.matched, h.score_contribution, h.details, h.evaluated_at,
            r.code, r.name, r.severity, r.weight
       FROM fraud_rule_hits h
       JOIN fraud_rules r ON r.rule_id = h.rule_id
      WHERE h.txn_id = ?
      ORDER BY h.hit_id`,
    [txnId]
  );

  return { ...txn, ruleHits: hits };
}

module.exports = { listAccounts, getAccount, listTransactions, getTransactionDetail };
