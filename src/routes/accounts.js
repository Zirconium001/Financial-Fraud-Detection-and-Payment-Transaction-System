'use strict';

const express = require('express');
const asyncHandler = require('../utils/asyncHandler');
const { authenticate } = require('../middleware/auth');
const accountService = require('../services/accountService');

const router = express.Router();

router.use(authenticate);

router.get('/', asyncHandler(async (req, res) => {
  const accounts = await accountService.listAccounts(req.user);
  res.json({ ok: true, accounts });
}));

router.get('/:id', asyncHandler(async (req, res) => {
  const account = await accountService.getAccount(req.user, Number(req.params.id));
  res.json({ ok: true, account });
}));

module.exports = router;
