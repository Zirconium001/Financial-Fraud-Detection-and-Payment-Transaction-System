'use strict';

/**
 * setup-db.js
 * Creates the schema, stored procedures, triggers, views, RBAC roles,
 * master-data seed, application users, and a set of synthetic transactions.
 *
 *   node scripts/setup-db.js            # create / recreate everything
 *   node scripts/setup-db.js --reset    # explicit alias for a full rebuild
 */

const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
const { simulate, summarize, buildPool } = require('./lib/fraud-sim');

const ROOT = path.join(__dirname, '..');
const DB_DIR = path.join(ROOT, 'database');
const DB_NAME = process.env.DB_NAME || 'fraud_detection';

const baseConn = () => ({
  host: process.env.DB_HOST || '127.0.0.1',
  port: parseInt(process.env.DB_PORT || '3306', 10),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  multipleStatements: false
});

/**
 * Remove `--` line comments and block comments so that semicolons that appear
 * inside prose comments cannot be mistaken for statement terminators.
 * (No string literal in this project contains `--` or `/*`.)
 */
function stripComments(sqlText) {
  return sqlText
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/--[^\n]*/g, '');
}

/**
 * True if a statement fragment contains any executable SQL.
 */
function hasSqlContent(stmt) {
  return stmt.trim().length > 0;
}

/**
 * Split a .sql script into statements, honouring client-side DELIMITER
 * directives (used for stored procedures / triggers).
 */
function splitStatements(sqlText) {
  const statements = [];
  let delimiter = ';';
  let buffer = '';
  const lines = stripComments(sqlText).split(/\r?\n/);

  for (const line of lines) {
    const m = /^\s*DELIMITER\s+(.+?)\s*$/i.exec(line);
    if (m) {
      if (hasSqlContent(buffer)) statements.push(buffer.trim());
      buffer = '';
      delimiter = m[1];
      continue;
    }
    buffer += line + '\n';
    while (buffer.includes(delimiter)) {
      const idx = buffer.indexOf(delimiter);
      const stmt = buffer.slice(0, idx).trim();
      if (hasSqlContent(stmt)) statements.push(stmt);
      buffer = buffer.slice(idx + delimiter.length);
    }
  }
  if (hasSqlContent(buffer)) statements.push(buffer.trim());
  return statements;
}

async function runFile(conn, fileName, { tolerateErrors = false, label } = {}) {
  const full = path.join(DB_DIR, fileName);
  const text = fs.readFileSync(full, 'utf8');
  const statements = splitStatements(text);
  let ran = 0;
  for (const stmt of statements) {
    try {
      await conn.query(stmt);
      ran++;
    } catch (err) {
      if (tolerateErrors) {
        console.warn(`  ! ${fileName}: skipped (${err.code || err.errno || 'ERR'}) ${String(err.sqlMessage || err.message).slice(0, 90)}`);
      } else {
        console.error(`  x ${fileName}: failed statement:\n${stmt.slice(0, 200)}\n  -> ${err.message}`);
        throw err;
      }
    }
  }
  console.log(`  + ${label || fileName}: ${ran} statement(s) applied`);
}

async function seedUsers(conn) {
  const users = [
    ['admin',     'admin@sentinelpay.local',     'admin123',    'admin',    null, null],
    ['analyst',   'analyst@sentinelpay.local',   'analyst123',  'analyst',  null, null],
    ['customer1', 'alice.johnson@example.com',   'customer123', 'customer', 1,    null],
    ['customer2', 'bob.smith@example.com',        'customer123', 'customer', 2,    null],
    ['merchant1', 'acme@sentinelpay.local',       'merchant123', 'merchant', null, 1],
    ['merchant2', 'quickcash@sentinelpay.local',  'merchant123', 'merchant', null, 2]
  ];

  for (const [username, email, password, role, customerId, merchantId] of users) {
    const hash = await bcrypt.hash(password, 10);
    await conn.query(
      `INSERT INTO users (username, email, password_hash, role, customer_id, merchant_id)
       VALUES (?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         email = VALUES(email), password_hash = VALUES(password_hash), role = VALUES(role)`,
      [username, email, hash, role, customerId, merchantId]
    );
  }
  console.log(`  + users: ${users.length} application accounts seeded`);
}

async function main() {
  console.log(`\n== SentinelPay DB setup (target: ${DB_NAME}) ==\n`);

  // 1) Create the database with a bootstrap connection (no default schema).
  const root = await mysql.createConnection(baseConn());
  try {
    console.log('[1/6] schema + master tables');
    await runFile(root, '01_schema.sql', { label: '01_schema.sql' });
  } finally {
    await root.end();
  }

  // 2) Everything else runs against the freshly created schema.
  const conn = await mysql.createConnection({ ...baseConn(), database: DB_NAME });
  try {
    console.log('[2/6] stored procedures');
    await runFile(conn, '02_procedures.sql');

    console.log('[3/6] triggers');
    await runFile(conn, '03_triggers.sql');

    console.log('[4/6] views');
    await runFile(conn, '04_views.sql');

    console.log('[5/6] RBAC roles (optional; errors tolerated on XAMPP/MariaDB)');
    await runFile(conn, '05_rbac.sql', { tolerateErrors: true });

    console.log('[6/6] seed + synthetic transactions');
    await runFile(conn, '06_seed.sql');
    await seedUsers(conn);
    await conn.query('CALL sp_recompute_all_risk()');

    const simPool = buildPool();
    try {
      const sim = await simulate(simPool);
      console.log(`  + injected ${sim.ok.length} transaction(s), ${sim.failed.length} skipped`);
      for (const f of sim.failed) console.log(`      - ${f.label}: ${f.error}`);

      await simPool.query('CALL sp_recompute_all_risk()');
      const summary = await summarize(simPool);

      console.log('\n-- Summary ----------------------------------------------');
      console.log(`  transactions : ${summary.transactions.total} (completed ${summary.transactions.completed}, flagged ${summary.transactions.flagged}, quarantined ${summary.transactions.quarantined})`);
      console.log('  rule matches :');
      for (const r of summary.ruleMatches) console.log(`      ${r.code.padEnd(20)} ${r.matches}`);
    } finally {
      await simPool.end();
    }

    console.log('\n  Login with: admin/admin123, analyst/analyst123,');
    console.log('              customer1/customer123, merchant1/merchant123');
    console.log('  Start the API:  npm start\n');
  } finally {
    await conn.end();
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error('\nSetup failed:', err.message);
    process.exit(1);
  });
}

module.exports = { splitStatements, runFile };
