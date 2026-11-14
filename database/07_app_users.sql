-- =============================================================================
--  Financial Fraud Detection & Payment Transaction System
--  07_app_users.sql  --  Application login accounts (bcrypt-hashed passwords)
-- =============================================================================
--  Run this AFTER 06_seed.sql. These are the accounts you log into the web app
--  with (they store bcrypt hashes; the DB never sees plaintext).
--
--    admin     / admin123      (role: admin)
--    analyst   / analyst123    (role: analyst)
--    customer1 / customer123   (role: customer  -> customers.customer_id = 1)
--    customer2 / customer123   (role: customer  -> customers.customer_id = 2)
--    merchant1 / merchant123   (role: merchant  -> merchants.merchant_id = 1)
--    merchant2 / merchant123   (role: merchant  -> merchants.merchant_id = 2)
-- =============================================================================

USE fraud_detection;

INSERT INTO users (username, email, password_hash, role, customer_id, merchant_id) VALUES
  ('admin',     'admin@sentinelpay.local',    '$2a$10$Sr2n4Sn7j48PLtHQ/SyvN.SixTn4JFRGQ8YSjyt6xgy9l.V9chJo.', 'admin',    NULL, NULL),
  ('analyst',   'analyst@sentinelpay.local',  '$2a$10$pSRSHe1Wy4OB2gug3SnlrOqZSAH5KsomQmqmwJxeJIARao2In2RQe', 'analyst',  NULL, NULL),
  ('customer1', 'alice.johnson@example.com',  '$2a$10$gIrznj7bbWmVtehj.R9JA.mAohKXm5gTnUyp4XOh/bi7zqYUGkHNa', 'customer', 1,    NULL),
  ('customer2', 'bob.smith@example.com',      '$2a$10$9hk0hIFsIzZmO9cFoZT2O.4DwfG2QPlY1ysABjC2yIChrmvnMNmLy', 'customer', 2,    NULL),
  ('merchant1', 'acme@sentinelpay.local',     '$2a$10$o2jBs9v/5/CzWDIT1rDu/uEr8rCcSUONcOO6KYyxqQ6w.O.gtm6py', 'merchant', NULL, 1),
  ('merchant2', 'quickcash@sentinelpay.local','$2a$10$iCbH2jIODKvRjzW4fcpInuRpr08I2cC9swmvd2XxP7JPO5GqF262q', 'merchant', NULL, 2)
ON DUPLICATE KEY UPDATE
  email         = VALUES(email),
  password_hash = VALUES(password_hash),
  role          = VALUES(role);
