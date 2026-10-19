-- =============================================================================
--  06_seed.sql  --  Master data (customers, accounts, cards, merchants,
--  devices, account_devices, blacklist).  Transactional data is generated
--  through the stored procedures by scripts/setup-db.js so that scoring,
--  audit, and balance changes are all exercised for real.
-- =============================================================================

USE fraud_detection;

-- ----------------------------------------------------------------------------
-- customers
-- ----------------------------------------------------------------------------
INSERT INTO customers
  (customer_id, full_name, email, phone, national_id, address_line, city, country, kyc_status, risk_score) VALUES
  (1, 'Alice Johnson', 'alice.johnson@example.com', '+1-202-555-0101', 'NID-1001', '12 Maple St',  'Springfield', 'US', 'verified', 5),
  (2, 'Bob Smith',     'bob.smith@example.com',     '+1-202-555-0102', 'NID-1002', '48 Oak Ave',    'Riverton',    'US', 'verified', 12),
  (3, 'Carol Diaz',    'carol.diaz@example.com',    '+1-202-555-0103', 'NID-1003', '7 Pine Rd',     'Lakeview',    'US', 'verified', 30),
  (4, 'David Lee',     'david.lee@example.com',     '+1-202-555-0104', 'NID-1004', '900 Elm Blvd',  'Metropolis',  'US', 'verified', 8),
  (5, 'Eva Green',     'eva.green@example.com',     '+1-202-555-0105', 'NID-1005', '3 Birch Ct',    'Hilltown',    'GB', 'pending',  20),
  (6, 'Frank Moe',     'frank.moe@example.com',     '+1-202-555-0106', 'NID-1006', '55 Cedar Ln',   'Baytown',     'US', 'verified', 40);

-- ----------------------------------------------------------------------------
-- accounts
-- ----------------------------------------------------------------------------
INSERT INTO accounts
  (account_id, customer_id, account_number, account_type, currency, balance, status) VALUES
  (1, 1, 'ACC-100001', 'savings', 'USD', 25000.00, 'active'),
  (2, 1, 'ACC-100002', 'current', 'USD',  8000.00, 'active'),
  (3, 2, 'ACC-100003', 'savings', 'USD', 15000.00, 'active'),
  (4, 3, 'ACC-100004', 'wallet',  'USD',  5000.00, 'active'),
  (5, 4, 'ACC-100005', 'savings', 'USD', 42000.00, 'active'),
  (6, 5, 'ACC-100006', 'savings', 'USD',  3000.00, 'active'),
  (7, 6, 'ACC-100007', 'current', 'USD', 12000.00, 'active'),
  (8, 2, 'ACC-100008', 'wallet',  'USD',  1000.00, 'active');

-- ----------------------------------------------------------------------------
-- cards
-- ----------------------------------------------------------------------------
INSERT INTO cards
  (account_id, card_number, card_type, network, expiry_date, status) VALUES
  (1, '4111********1111', 'debit',  'visa',       '2027-05-31', 'active'),
  (3, '5500********3333', 'credit', 'mastercard', '2026-11-30', 'active'),
  (5, '4000********5555', 'debit',  'visa',       '2028-01-31', 'active'),
  (6, '3400********6666', 'credit', 'amex',       '2026-08-31', 'active');

-- ----------------------------------------------------------------------------
-- merchants
-- ----------------------------------------------------------------------------
INSERT INTO merchants
  (merchant_id, name, category, country, city, latitude, longitude, risk_level, is_blacklisted) VALUES
  (1, 'Acme Electronics', 'retail',    'US', 'Springfield', 39.781700, -89.650100, 'low',    0),
  (2, 'QuickCash Pawn',   'pawn',      'US', 'Riverton',    40.700000, -74.010000, 'high',   0),
  (3, 'Global Travels',   'travel',    'US', 'Metropolis',  40.712800, -74.006000, 'medium', 0),
  (4, 'DarkNet Goods',    'unknown',   'US', 'Baytown',     37.338200, -121.886300, 'high',   1),
  (5, 'Coffee House',     'food',      'US', 'Springfield', 39.800000, -89.640000, 'low',    0);

-- ----------------------------------------------------------------------------
-- devices  (FP-SHARED-01 is deliberately reused across customers -> ring)
-- ----------------------------------------------------------------------------
INSERT INTO devices
  (device_id, device_fingerprint, os, browser, last_ip) VALUES
  (1, 'FP-ALICE-01',  'Windows 11', 'Chrome',  '203.0.113.10'),
  (2, 'FP-BOB-01',    'macOS 14',   'Safari',  '203.0.113.20'),
  (3, 'FP-SHARED-01', 'Android 14', 'Chrome',  '198.51.100.30'),
  (4, 'FP-CAROL-01',  'iOS 17',     'Safari',  '198.51.100.31'),
  (5, 'FP-EVA-01',    'Windows 10', 'Edge',    '203.0.113.50'),
  (6, 'FP-FRANK-01',  'Android 13', 'Firefox', '198.51.100.31');

-- ----------------------------------------------------------------------------
-- account_devices  (Carol + Frank share FP-SHARED-01)
-- ----------------------------------------------------------------------------
INSERT INTO account_devices (account_id, device_id, times_used) VALUES
  (1, 1, 3),
  (3, 2, 2),
  (4, 3, 5),
  (7, 3, 4),
  (4, 4, 1),
  (6, 5, 2),
  (7, 6, 1);

-- ----------------------------------------------------------------------------
-- blacklist
-- ----------------------------------------------------------------------------
INSERT INTO blacklist (entity_type, entity_value, reason, severity) VALUES
  ('ip',       '203.0.113.66', 'Known fraud host',            'critical'),
  ('ip',       '198.51.100.7', 'Botnet exit node',            'high'),
  ('merchant', '4',            'Merchant blacklisted',        'critical'),
  ('device',   'FP-DARK-01',   'Device linked to chargebacks', 'high');
