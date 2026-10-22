'use strict';

/**
 * Domain error carrying an HTTP status code.
 */
class AppError extends Error {
  constructor(message, status = 400, code = 'BAD_REQUEST') {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
  }
}

/**
 * Translate a raw MySQL error into a friendly AppError.
 * Business-rule SIGNAL SQLSTATE '45000' => 409 Conflict.
 */
function normalizeDbError(err) {
  if (err && err.sqlState === '45000') {
    return new AppError(err.sqlMessage || err.message, 409, 'BUSINESS_RULE');
  }
  if (err && err.code === 'ER_DUP_ENTRY') {
    return new AppError('Duplicate value violates a unique constraint', 409, 'DUPLICATE');
  }
  if (err && err.code === 'ER_NO_REFERENCED_ROW_2') {
    return new AppError('Referenced record does not exist', 400, 'FK_VIOLATION');
  }
  if (err && err.code === 'ER_ROW_IS_REFERENCED_2') {
    return new AppError('Record is referenced by other data', 409, 'FK_RESTRICT');
  }
  return err;
}

module.exports = { AppError, normalizeDbError };
