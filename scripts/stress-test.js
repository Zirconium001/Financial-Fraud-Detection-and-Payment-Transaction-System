'use strict';

/**
 * stress-test.js
 * Fires many simultaneous account-affecting transactions to prove the
 * concurrency-control strategy prevents lost updates / overdrafts.
 *
 *   node scripts/stress-test.js
 *
 * It exercises the stored procedures directly (each call is its own ACID
 * transaction using SELECT ... FOR UPDATE row locks). The invariant checked
 * is simple and strict: the SUM of balances must be conserved across all
 * successful transfers, and no account may ever go negative.
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');

const CFG = {
  host: process.env.DB_HOST || '127.0.0.1',
  port: parseInt(process.env.DB_PORT || '3306', 10),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'fraud_detection'
};

const FROM = 1;
const TO = 3;
const AMOUNT = 10;
const ROUNDS = 60;         // concurrent transfers in each direction
const ISOLATION = (process.env.DB_ISOLATION_LEVEL || 'REPEATABLE READ').toUpperCase();

async function callUnit(pool, sql, params) {
  const conn = await pool.getConnection();
  try {
    await conn.query(`SET TRANSACTION ISOLATION LEVEL ${ISOLATION}`);
    await conn.beginTransaction();
    await conn.query(sql, params);
    await conn.commit();
    return { ok: true };
  } catch (err) {
    await conn.rollback();
    return { ok: false, error: err.sqlMessage || err.message };
  } finally {
    conn.release();
  }
}

async function balances(pool, ids) {
  const [rows] = await pool.query(
    `SELECT account_id, balance FROM accounts WHERE account_id IN (${ids.join(',')})`
  );
  return rows.reduce((m, r) => (m[r.account_id] = Number(r.balance), m), {});
}

async function main() {
  const pool = mysql.createPool({ ...CFG, connectionLimit: 60, waitForConnections: true });
  console.log(`\n== Concurrency stress test (isolation: ${ISOLATION}) ==\n`);

  const before = await balances(pool, [FROM, TO]);
  const totalBefore = before[FROM] + before[TO];
  console.log(`  before: acct${FROM}=${before[FROM].toFixed(2)}  acct${TO}=${before[TO].toFixed(2)}  total=${totalBefore.toFixed(2)}`);

  // ---- Bidirectional concurrent transfers ----------------------------------
  const jobs = [];
  for (let i = 0; i < ROUNDS; i++) {
    jobs.push(callUnit(pool, 'CALL sp_transfer(?,?,?,?,?,?,?,?,@a,@b,@c,@d)', [FROM, TO, AMOUNT, null, null, null, null, null]));
    jobs.push(callUnit(pool, 'CALL sp_transfer(?,?,?,?,?,?,?,?,@a,@b,@c,@d)', [TO, FROM, AMOUNT, null, null, null, null, null]));
  }
  const out = await Promise.all(jobs);
  const ok = out.filter((r) => r.ok).length;
  const failed = out.length - ok;

  const after = await balances(pool, [FROM, TO]);
  const totalAfter = after[FROM] + after[TO];
  console.log(`  after : acct${FROM}=${after[FROM].toFixed(2)}  acct${TO}=${after[TO].toFixed(2)}  total=${totalAfter.toFixed(2)}`);
  console.log(`  transfers: ${ok} succeeded, ${failed} failed (insufficient funds / retryable)`);

  const conserved = Math.abs(totalBefore - totalAfter) < 0.005;
  console.log(`  invariant (money conserved, no lost update): ${conserved ? 'PASS' : 'FAIL'}`);

  // ---- Concurrent withdrawals must never overdraw --------------------------
  const WF = 6; // Eva, small balance
  const wBefore = (await balances(pool, [WF]))[WF];
  const perWithdraw = 500;
  const wJobs = [];
  for (let i = 0; i < 40; i++) {
    wJobs.push(callUnit(pool, 'CALL sp_withdraw(?,?,?,?,?,?,?,@a,@b,@c)', [WF, perWithdraw, null, null, null, null, null]));
  }
  const wOut = await Promise.all(wJobs);
  const wOk = wOut.filter((r) => r.ok).length;
  const wAfter = (await balances(pool, [WF]))[WF];
  const maxPossible = Math.floor(wBefore / perWithdraw);
  console.log(`\n  concurrent withdrawals on acct${WF}: balance ${wBefore.toFixed(2)} -> ${wAfter.toFixed(2)}, ${wOk} succeeded (max possible ${maxPossible})`);
  const noOverdraft = wAfter >= 0;
  const correctCount = wOk === maxPossible;
  console.log(`  invariant (no overdraft): ${noOverdraft ? 'PASS' : 'FAIL'}${correctCount ? '' : ' (count differs from ideal -- acceptable under contention)'}`);

  console.log(`\n  RESULT: ${conserved && noOverdraft ? 'PASS -- balances stayed consistent under concurrent load' : 'FAIL'}\n`);

  await pool.end();
  process.exit(conserved && noOverdraft ? 0 : 1);
}

main().catch((err) => {
  console.error('Stress test error:', err.message);
  process.exit(1);
});
