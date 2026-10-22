'use strict';

const { pool, withTransaction } = require('../config/db');
const bcrypt = require('bcryptjs');
const { AppError } = require('../utils/errors');

async function login(username, password) {
  const [rows] = await pool.query(
    `SELECT user_id, username, email, password_hash, role,
            customer_id, merchant_id, is_active
       FROM users WHERE username = ? OR email = ? LIMIT 1`,
    [username, username]
  );

  const user = rows[0];
  if (!user || !user.is_active) {
    throw new AppError('Invalid credentials', 401, 'UNAUTHORIZED');
  }

  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) {
    throw new AppError('Invalid credentials', 401, 'UNAUTHORIZED');
  }

  await pool.query('UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE user_id = ?', [user.user_id]);

  return {
    userId: user.user_id,
    username: user.username,
    email: user.email,
    role: user.role,
    customerId: user.customer_id,
    merchantId: user.merchant_id
  };
}

async function getProfile(userId) {
  const [rows] = await pool.query(
    `SELECT user_id, username, email, role, customer_id, merchant_id, last_login
       FROM users WHERE user_id = ?`,
    [userId]
  );
  if (!rows.length) throw new AppError('User not found', 404, 'NOT_FOUND');
  return rows[0];
}

/**
 * Register a new application user. Used by setup/dev tooling.
 */
async function createUser({ username, email, password, role, customerId = null, merchantId = null }) {
  const hash = await bcrypt.hash(password, 10);
  const [result] = await pool.query(
    `INSERT INTO users (username, email, password_hash, role, customer_id, merchant_id)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [username, email, hash, role, customerId, merchantId]
  );
  return result.insertId;
}

/** Seed helper: upsert a user, hashing the password (idempotent). */
async function upsertUser(conn, { username, email, password, role, customerId = null, merchantId = null }) {
  const hash = await bcrypt.hash(password, 10);
  const db = conn || pool;
  await db.query(
    `INSERT INTO users (username, email, password_hash, role, customer_id, merchant_id)
     VALUES (?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE password_hash = VALUES(password_hash), role = VALUES(role)`,
    [username, email, hash, role, customerId, merchantId]
  );
}

const ACCOUNT_TYPES = ['savings', 'current', 'wallet'];

/**
 * Public self-registration: creates a customer, their first bank account and
 * the login identity in a single ACID transaction. Always role 'customer'.
 */
async function register({ username, email, password, fullName, phone = null, accountType = 'savings', country = 'US' }) {
  const uname = String(username || '').trim();
  const mail = String(email || '').trim().toLowerCase();
  const name = String(fullName || '').trim();
  const type = ACCOUNT_TYPES.includes(accountType) ? accountType : 'savings';

  if (uname.length < 3) throw new AppError('Username must be at least 3 characters', 400, 'BAD_REQUEST');
  if (!mail || !mail.includes('@')) throw new AppError('A valid email is required', 400, 'BAD_REQUEST');
  if (String(password || '').length < 6) throw new AppError('Password must be at least 6 characters', 400, 'BAD_REQUEST');
  if (!name) throw new AppError('Full name is required', 400, 'BAD_REQUEST');

  return withTransaction(async (conn) => {
    const [dup] = await conn.query(
      'SELECT user_id FROM users WHERE username = ? OR email = ? LIMIT 1',
      [uname, mail]
    );
    if (dup.length) throw new AppError('Username or email is already registered', 409, 'DUPLICATE');

    const [cust] = await conn.query(
      `INSERT INTO customers (full_name, email, phone, country, kyc_status, risk_score)
       VALUES (?, ?, ?, ?, 'pending', 0)`,
      [name, mail, phone, country]
    );
    const customerId = cust.insertId;

    const [mx] = await conn.query(
      `SELECT COALESCE(MAX(CAST(SUBSTRING(account_number, 5) AS UNSIGNED)), 100000) AS mx
         FROM accounts WHERE account_number LIKE 'ACC-%'`
    );
    const accountNumber = 'ACC-' + (Number(mx[0].mx) + 1);

    const [acct] = await conn.query(
      `INSERT INTO accounts (customer_id, account_number, account_type, currency, balance, status)
       VALUES (?, ?, ?, 'USD', 0.00, 'active')`,
      [customerId, accountNumber, type]
    );

    const hash = await bcrypt.hash(password, 10);
    const [u] = await conn.query(
      `INSERT INTO users (username, email, password_hash, role, customer_id, merchant_id)
       VALUES (?, ?, ?, 'customer', ?, NULL)`,
      [uname, mail, hash, customerId]
    );

    return {
      userId: u.insertId,
      username: uname,
      email: mail,
      role: 'customer',
      customerId,
      merchantId: null,
      accountId: acct.insertId,
      accountNumber
    };
  });
}

module.exports = { login, getProfile, createUser, upsertUser, register };
