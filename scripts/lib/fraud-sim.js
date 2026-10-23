'use strict';

/**
 * fraud-sim.js
 * Injects synthetic transaction patterns -- both legitimate and fraudulent --
 * directly through the stored procedures so that the fraud-scoring engine,
 * audit triggers, and balance updates are all exercised for real.
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });
const mysql = require('mysql2/promise');

function buildPool() {
  return mysql.createPool({
    host: process.env.DB_HOST || '127.0.0.1',
    port: parseInt(process.env.DB_PORT || '3306', 10),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'fraud_detection',
    connectionLimit: 10,
    supportBigNumbers: true,
    namedPlaceholders: false
  });
}

/** Run one procedure call inside its own autocommit unit (rollback on error). */
async function unit(pool, sql, params, label, results) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query(sql, params);
    await conn.commit();
    if (results) results.ok.push(label);
  } catch (err) {
    await conn.rollback();
    if (results) results.failed.push({ label, error: err.sqlMessage || err.message });
    else throw err;
  } finally {
    conn.release();
  }
}

async function simulate(pool) {
  const results = { ok: [], failed: [] };

  // ---- Legitimate activity -------------------------------------------------
  await unit(pool, 'CALL sp_deposit(?,?,?,?,?,@a,@b,@c)', [1, 5000, 1, 1, '203.0.113.10'], 'legit: deposit acct1', results);
  await unit(pool, 'CALL sp_deposit(?,?,?,?,?,@a,@b,@c)', [3, 2000, 2, 2, '203.0.113.20'], 'legit: deposit acct3', results);
  await unit(pool, 'CALL sp_transfer(?,?,?,?,?,?,?,?,@a,@b,@c,@d)', [5, 1, 1500, 4, 1, '203.0.113.40', null, null], 'legit: transfer acct5->1', results);
  await unit(pool, 'CALL sp_transfer(?,?,?,?,?,?,?,?,@a,@b,@c,@d)', [2, 3, 500, 1, 1, '203.0.113.10', null, null], 'legit: transfer acct2->3', results);
  await unit(pool, 'CALL sp_payment(?,?,?,?,?,?,?,?,@a,@b,@c)', [1, 5, 25, 1, 1, '203.0.113.10', 39.8, -89.64], 'legit: payment merchant5', results);

  // ---- 1. Velocity: rapid consecutive withdrawals (acct5) ------------------
  for (let i = 0; i < 6; i++) {
    await unit(pool, 'CALL sp_withdraw(?,?,?,?,?,?,?,@a,@b,@c)', [5, 100, 4, 5, '203.0.113.50', null, null], 'fraud: velocity withdraw #' + (i + 1), results);
  }

  // ---- 2. Structuring: repeated near-threshold withdrawals (acct5) ---------
  for (let i = 0; i < 4; i++) {
    await unit(pool, 'CALL sp_withdraw(?,?,?,?,?,?,?,@a,@b,@c)', [5, 9500, 4, 5, '203.0.113.50', null, null], 'fraud: structuring #' + (i + 1), results);
  }

  // ---- 3. High amount single transfer --------------------------------------
  await unit(pool, 'CALL sp_transfer(?,?,?,?,?,?,?,?,@a,@b,@c,@d)', [5, 1, 15000, 4, 5, '203.0.113.50', null, null], 'fraud: high amount transfer', results);

  // ---- 4. Impossible travel (geo mismatch on acct4) ------------------------
  await unit(pool, 'CALL sp_withdraw(?,?,?,?,?,?,?,@a,@b,@c)', [4, 300, 3, 3, '198.51.100.30', 40.712800, -74.006000], 'fraud: geo NY', results);
  await unit(pool, 'CALL sp_withdraw(?,?,?,?,?,?,?,@a,@b,@c)', [4, 300, 3, 3, '198.51.100.30', 37.774900, -122.419400], 'fraud: geo SF', results);

  // ---- 5. Shared-device reuse (acct4 cust3 + acct7 cust6, device 3) --------
  await unit(pool, 'CALL sp_deposit(?,?,?,?,?,@a,@b,@c)', [4, 50, 3, 3, '198.51.100.30'], 'fraud: shared device acct4', results);
  await unit(pool, 'CALL sp_deposit(?,?,?,?,?,@a,@b,@c)', [7, 50, 6, 3, '198.51.100.31'], 'fraud: shared device acct7', results);

  // ---- 6. Blacklisted IP ----------------------------------------------------
  await unit(pool, 'CALL sp_transfer(?,?,?,?,?,?,?,?,@a,@b,@c,@d)', [6, 1, 200, 5, 5, '203.0.113.66', null, null], 'fraud: blacklisted IP', results);

  // ---- 7. Blacklisted merchant ---------------------------------------------
  await unit(pool, 'CALL sp_payment(?,?,?,?,?,?,?,?,@a,@b,@c)', [1, 4, 500, 1, 1, '203.0.113.10', 37.3382, -121.8863], 'fraud: blacklisted merchant', results);

  return results;
}

async function summarize(pool) {
  const [[txn]] = await pool.query(
    `SELECT COUNT(*) AS total,
            SUM(status='completed')  AS completed,
            SUM(status='flagged')    AS flagged,
            SUM(status='quarantined')AS quarantined
       FROM transactions`
  );
  const [hits] = await pool.query(
    `SELECT r.code, COUNT(*) AS matches
       FROM fraud_rule_hits h JOIN fraud_rules r ON r.rule_id = h.rule_id
      WHERE h.matched = 1 GROUP BY r.code ORDER BY matches DESC`
  );
  return { transactions: txn, ruleMatches: hits };
}

module.exports = { simulate, summarize, buildPool };
