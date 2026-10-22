'use strict';

const { withTransaction } = require('../config/db');
const { AppError } = require('../utils/errors');

async function deposit({ accountId, amount, actorUserId, deviceId = null, ip = null }) {
  return withTransaction(async (conn) => {
    await conn.query(
      'CALL sp_deposit(?, ?, ?, ?, ?, @txn, @risk, @status)',
      [accountId, amount, actorUserId, deviceId, ip]
    );
    const [[out]] = await conn.query(
      'SELECT @txn AS txnId, @risk AS riskScore, @status AS status'
    );
    return fetchMoveSummary(conn, out.txnId, out.riskScore, out.status, 'deposit', amount);
  });
}

async function withdraw({ accountId, amount, actorUserId, deviceId = null, ip = null, lat = null, lon = null }) {
  return withTransaction(async (conn) => {
    await conn.query(
      'CALL sp_withdraw(?, ?, ?, ?, ?, ?, ?, @txn, @risk, @status)',
      [accountId, amount, actorUserId, deviceId, ip, lat, lon]
    );
    const [[out]] = await conn.query(
      'SELECT @txn AS txnId, @risk AS riskScore, @status AS status'
    );
    return fetchMoveSummary(conn, out.txnId, out.riskScore, out.status, 'withdrawal', amount);
  });
}

async function transfer({ fromAccountId, toAccountId, amount, actorUserId, deviceId = null, ip = null, lat = null, lon = null }) {
  return withTransaction(async (conn) => {
    await conn.query(
      'CALL sp_transfer(?, ?, ?, ?, ?, ?, ?, ?, @txnOut, @txnIn, @risk, @status)',
      [fromAccountId, toAccountId, amount, actorUserId, deviceId, ip, lat, lon]
    );
    const [[out]] = await conn.query(
      'SELECT @txnOut AS txnOut, @txnIn AS txnIn, @risk AS riskScore, @status AS status'
    );

    const [[src]] = await conn.query('SELECT balance FROM accounts WHERE account_id = ?', [fromAccountId]);
    const [[dst]] = await conn.query('SELECT balance FROM accounts WHERE account_id = ?', [toAccountId]);

    return {
      direction: 'transfer',
      amount,
      transaction: {
        out: { txnId: out.txnOut, accountId: fromAccountId, balanceAfter: src ? src.balance : null },
        in: { txnId: out.txnIn, accountId: toAccountId, balanceAfter: dst ? dst.balance : null }
      },
      riskScore: out.riskScore,
      status: out.status
    };
  });
}

async function fetchMoveSummary(conn, txnId, riskScore, status, direction, amount) {
  const [[acct]] = await conn.query(
    'SELECT balance FROM accounts WHERE account_id = (SELECT account_id FROM transactions WHERE txn_id = ?)',
    [txnId]
  );
  return {
    direction,
    amount,
    transaction: {
      txnId,
      balanceAfter: acct ? acct.balance : null
    },
    riskScore,
    status
  };
}

async function payment({ accountId, merchantId, amount, actorUserId, deviceId = null, ip = null, lat = null, lon = null }) {
  return withTransaction(async (conn) => {
    await conn.query(
      'CALL sp_payment(?, ?, ?, ?, ?, ?, ?, ?, @txn, @risk, @status)',
      [accountId, merchantId, amount, actorUserId, deviceId, ip, lat, lon]
    );
    const [[out]] = await conn.query(
      'SELECT @txn AS txnId, @risk AS riskScore, @status AS status'
    );
    return fetchMoveSummary(conn, out.txnId, out.riskScore, out.status, 'payment', amount);
  });
}

module.exports = { deposit, withdraw, transfer, payment };
