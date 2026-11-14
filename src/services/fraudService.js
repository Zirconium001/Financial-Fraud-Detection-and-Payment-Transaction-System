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

async function recomputeRisk(actorUserId) {
  return withTransaction(async (conn) => {
    await conn.query('CALL sp_recompute_all_risk()');
    await writeAudit(conn, actorUserId, 'ADMIN_RECOMPUTE_RISK', {});
    return { ok: true };
  });
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

async function addBlacklist({ entityType, entityValue, reason, severity = 'high', actorUserId }) {
  return withTransaction(async (conn) => {
    const [result] = await conn.query(
      `INSERT INTO blacklist (entity_type, entity_value, reason, severity)
       VALUES (?, ?, ?, ?)`,
      [entityType, entityValue, reason, severity]
    );
    await writeAudit(conn, actorUserId, 'ADMIN_BLACKLIST_ADD', {
      blacklist_id: result.insertId,
      entity_type: entityType,
      entity_value: entityValue,
      severity
    });
    return { blacklistId: result.insertId };
  });
}

async function deleteBlacklist(blacklistId, actorUserId) {
  return withTransaction(async (conn) => {
    const [rows] = await conn.query(
      'SELECT entity_type, entity_value FROM blacklist WHERE blacklist_id = ?',
      [blacklistId]
    );
    if (!rows.length) {
      throw new AppError('Blacklist entry not found', 404, 'NOT_FOUND');
    }

    await conn.query('DELETE FROM blacklist WHERE blacklist_id = ?', [blacklistId]);
    await writeAudit(conn, actorUserId, 'ADMIN_BLACKLIST_DELETE', {
      blacklist_id: blacklistId,
      entity_type: rows[0].entity_type,
      entity_value: rows[0].entity_value
    });
    return { blacklistId };
  });
}

function numericField(value, field, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < min || n > max) {
    throw new AppError(`Invalid ${field}`, 400, 'BAD_REQUEST');
  }
  return n;
}

function booleanField(value) {
  return value === true || value === 1 || value === '1' || value === 'true';
}

async function updateRule(ruleId, patch = {}, actorUserId) {
  const sets = [];
  const params = [];

  if (patch.threshold !== undefined) {
    sets.push('threshold = ?');
    params.push(numericField(patch.threshold, 'threshold'));
  }
  if (patch.weight !== undefined) {
    sets.push('weight = ?');
    params.push(numericField(patch.weight, 'weight', { max: 100 }));
  }
  if (patch.is_active !== undefined) {
    sets.push('is_active = ?');
    params.push(booleanField(patch.is_active) ? 1 : 0);
  }

  if (!sets.length) {
    throw new AppError('No editable fields supplied', 400, 'BAD_REQUEST');
  }

  return withTransaction(async (conn) => {
    const [existing] = await conn.query(
      'SELECT rule_id FROM fraud_rules WHERE rule_id = ?',
      [ruleId]
    );
    if (!existing.length) throw new AppError('Rule not found', 404, 'NOT_FOUND');

    params.push(ruleId);
    await conn.query(
      `UPDATE fraud_rules SET ${sets.join(', ')} WHERE rule_id = ?`,
      params
    );
    await writeAudit(conn, actorUserId, 'ADMIN_RULE_UPDATE', {
      rule_id: ruleId,
      changes: patch
    });

    const [rows] = await conn.query(
      `SELECT rule_id, code, name, description, rule_type, metric,
              threshold, window_seconds, severity, weight, is_active
         FROM fraud_rules WHERE rule_id = ?`,
      [ruleId]
    );
    return rows[0];
  });
}

async function writeAudit(conn, actorUserId, action, detail) {
  if (!actorUserId) return;
  await conn.query(
    'INSERT INTO audit_log (actor_user_id, action, detail) VALUES (?, ?, ?)',
    [actorUserId, action, JSON.stringify(detail || {})]
  );
}

module.exports = {
  listFlagged,
  listRules,
  ruleHitStats,
  ipRings,
  topRiskAccounts,
  reverseTransaction,
  recomputeRisk,
  blockAccount,
  unblockAccount,
  blockSuspicious,
  listBlacklist,
  addBlacklist,
  deleteBlacklist,
  updateRule
};
