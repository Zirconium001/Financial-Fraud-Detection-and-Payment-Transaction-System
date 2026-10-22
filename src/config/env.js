'use strict';

require('dotenv').config();

const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  db: {
    host: process.env.DB_HOST || '127.0.0.1',
    port: parseInt(process.env.DB_PORT || '3306', 10),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'fraud_detection',
    connectionLimit: parseInt(process.env.DB_CONNECTION_LIMIT || '20', 10),
    isolationLevel: (process.env.DB_ISOLATION_LEVEL || 'REPEATABLE READ').toUpperCase(),
    waitForConnections: true,
    namedPlaceholders: false,
    dateStrings: false,
    supportBigNumbers: true,
    bigNumberStrings: false
  },
  jwt: {
    secret: process.env.JWT_SECRET || 'dev-insecure-secret-change-me',
    expiresIn: process.env.JWT_EXPIRES_IN || '8h'
  },
  fraud: {
    flagThreshold: parseInt(process.env.FRAUD_FLAG_THRESHOLD || '70', 10)
  }
};

const ALLOWED_ISOLATION = [
  'READ COMMITTED',
  'REPEATABLE READ',
  'SERIALIZABLE'
];

if (!ALLOWED_ISOLATION.includes(config.db.isolationLevel)) {
  throw new Error(
    `Invalid DB_ISOLATION_LEVEL "${config.db.isolationLevel}". ` +
    `Allowed: ${ALLOWED_ISOLATION.join(', ')}`
  );
}

module.exports = config;
