'use strict';

const express = require('express');
const asyncHandler = require('../utils/asyncHandler');
const { authenticate, requireRole } = require('../middleware/auth');
const { AppError } = require('../utils/errors');
const accountService = require('../services/accountService');
const txnService = require('../services/transactionService');

const router = express.Router();

router.use(authenticate);

async function assertAccountAccess(user, accountId) {
  await accountService.getAccount(user, accountId); // throws if not permitted
}

router.get('/', asyncHandler(async (req, res) => {
  const rows = await accountService.listTransactions(req.user, {
    accountId: req.query.accountId ? Number(req.query.accountId) : undefined,
    status: req.query.status,
    limit: req.query.limit ? Number(req.query.limit) : undefined
  });
  res.json({ ok: true, transactions: rows });
}));

router.get('/:id', asyncHandler(async (req, res) => {
  const txn = await accountService.getTransactionDetail(req.user, Number(req.params.id));
  res.json({ ok: true, transaction: txn });
}));

router.post('/deposit', requireRole('customer', 'admin'), asyncHandler(async (req, res) => {
  const { accountId, amount, deviceId = null, ip = null } = req.body || {};
  if (!accountId || !amount) throw new AppError('accountId and amount are required');
  await assertAccountAccess(req.user, Number(accountId));

  const result = await txnService.deposit({
    accountId: Number(accountId),
    amount,
    actorUserId: req.user.userId,
    deviceId,
    ip
  });
  res.status(201).json({ ok: true, ...result });
}));

router.post('/withdraw', requireRole('customer', 'admin'), asyncHandler(async (req, res) => {
  const { accountId, amount, deviceId = null, ip = null, lat = null, lon = null } = req.body || {};
  if (!accountId || !amount) throw new AppError('accountId and amount are required');
  await assertAccountAccess(req.user, Number(accountId));

  const result = await txnService.withdraw({
    accountId: Number(accountId),
    amount,
    actorUserId: req.user.userId,
    deviceId,
    ip,
    lat,
    lon
  });
  res.status(201).json({ ok: true, ...result });
}));

router.post('/transfer', requireRole('customer', 'admin'), asyncHandler(async (req, res) => {
  const { fromAccountId, toAccountId, amount, deviceId = null, ip = null, lat = null, lon = null } = req.body || {};
  if (!fromAccountId || !toAccountId || !amount) {
    throw new AppError('fromAccountId, toAccountId and amount are required');
  }
  await assertAccountAccess(req.user, Number(fromAccountId));

  const result = await txnService.transfer({
    fromAccountId: Number(fromAccountId),
    toAccountId: Number(toAccountId),
    amount,
    actorUserId: req.user.userId,
    deviceId,
    ip,
    lat,
    lon
  });
  res.status(201).json({ ok: true, ...result });
}));

router.post('/payment', requireRole('customer', 'admin'), asyncHandler(async (req, res) => {
  const { accountId, merchantId, amount, deviceId = null, ip = null, lat = null, lon = null } = req.body || {};
  if (!accountId || !merchantId || !amount) {
    throw new AppError('accountId, merchantId and amount are required');
  }
  await assertAccountAccess(req.user, Number(accountId));

  const result = await txnService.payment({
    accountId: Number(accountId),
    merchantId: Number(merchantId),
    amount,
    actorUserId: req.user.userId,
    deviceId,
    ip,
    lat,
    lon
  });
  res.status(201).json({ ok: true, ...result });
}));

module.exports = router;
