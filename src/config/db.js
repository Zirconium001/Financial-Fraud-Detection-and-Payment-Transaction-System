'use strict';

const mysql = require('mysql2/promise');
const config = require('./env');

const { isolationLevel, ...poolOptions } = config.db;

const pool = mysql.createPool({
  ...poolOptions,
  queueLimit: 0,
  enableKeepAlive: true,
  keepAliveInitialDelay: 10000
});

/**
 * Run `fn(connection)` inside an explicit ACID transaction.
 * The isolation level can be overridden per call (READ COMMITTED /
 * REPEATABLE READ / SERIALIZABLE). On any thrown error the unit is rolled back.
 */
async function withTransaction(fn, level = isolationLevel) {
  const conn = await pool.getConnection();
  try {
    if (level) {
      await conn.query(`SET TRANSACTION ISOLATION LEVEL ${level}`);
    }
    await conn.beginTransaction();
    const result = await fn(conn);
    await conn.commit();
    return result;
  } catch (err) {
    try {
      await conn.rollback();
    } catch (rollbackErr) {
      // eslint-disable-next-line no-console
      console.error('Rollback failed:', rollbackErr.message);
    }
    throw err;
  } finally {
    conn.release();
  }
}

async function ping() {
  const conn = await pool.getConnection();
  try {
    await conn.ping();
  } finally {
    conn.release();
  }
}

module.exports = { pool, withTransaction, ping, isolationLevel };
