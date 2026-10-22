'use strict';

const { AppError, normalizeDbError } = require('../utils/errors');

function notFound(req, res, next) {
  next(new AppError(`Route not found: ${req.method} ${req.originalUrl}`, 404, 'NOT_FOUND'));
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  const appErr = err instanceof AppError ? err : normalizeDbError(err);
  const status = appErr.status || 500;

  if (status >= 500) {
    // eslint-disable-next-line no-console
    console.error('[ERROR]', appErr.message, appErr.sqlMessage || '');
  }

  res.status(status).json({
    ok: false,
    error: {
      code: appErr.code || 'INTERNAL_ERROR',
      message: status >= 500 ? 'Internal server error' : appErr.message
    }
  });
}

module.exports = { notFound, errorHandler };
