'use strict';

const { pool } = require('../config/db');

let cache = new Map();
let loaded = false;

function emptySet() {
  return new Set();
}

/**
 * Load every role -> permission mapping into memory. Called at startup and
 * after permissions are changed; role checks then avoid a DB round-trip.
 */
async function loadAll() {
  const [rows] = await pool.query(
    'SELECT role, permission_key FROM role_permissions'
  );

  const next = new Map();
  for (const row of rows) {
    if (!next.has(row.role)) next.set(row.role, new Set());
    next.get(row.role).add(row.permission_key);
  }

  cache = next;
  loaded = true;
  return cache;
}

async function forRole(role) {
  if (!loaded) {
    try {
      await loadAll();
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(`[rbac] could not load permissions: ${err.message}`);
      return emptySet();
    }
  }
  return cache.get(role) || emptySet();
}

function reload() {
  loaded = false;
  return loadAll();
}

function invalidate() {
  loaded = false;
}

module.exports = { loadAll, forRole, reload, invalidate };
