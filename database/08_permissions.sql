-- =============================================================================
--  08_permissions.sql  --  Application RBAC: permission catalog + role grants
-- =============================================================================
--  Normalized authorization model used by the Node API. The `users.role`
--  enum stays as the identity's role; this file defines what each role may do.
--  Admin is a superset of Analyst (separation of duties is enforced on the
--  destructive/admin-only permissions).
-- =============================================================================

USE fraud_detection;

DROP TABLE IF EXISTS role_permissions;
DROP TABLE IF EXISTS permissions;

CREATE TABLE permissions (
  permission_key VARCHAR(64)  NOT NULL,
  description    VARCHAR(255) NOT NULL,
  PRIMARY KEY (permission_key)
) ENGINE=InnoDB;

CREATE TABLE role_permissions (
  role           ENUM('customer','merchant','analyst','admin') NOT NULL,
  permission_key VARCHAR(64) NOT NULL,
  PRIMARY KEY (role, permission_key),
  CONSTRAINT fk_role_permissions_permission
    FOREIGN KEY (permission_key) REFERENCES permissions(permission_key)
    ON UPDATE CASCADE ON DELETE CASCADE
) ENGINE=InnoDB;

INSERT INTO permissions (permission_key, description) VALUES
  ('dashboard.view',        'View the fraud operations overview dashboard'),
  ('fraud.queue.view',      'View the flagged / quarantined transaction queue'),
  ('fraud.txn.reverse',     'Reverse a flagged transaction'),
  ('fraud.rules.view',      'View fraud rules and rule-hit statistics'),
  ('fraud.rules.edit',      'Edit fraud rule thresholds, weights, and activation'),
  ('fraud.rings.view',      'View shared-IP fraud rings'),
  ('fraud.risk.view',       'View highest-risk accounts'),
  ('fraud.risk.recompute',  'Recompute customer risk scores'),
  ('fraud.blacklist.view',  'View blacklist entries'),
  ('fraud.blacklist.edit',  'Add or remove blacklist entries'),
  ('fraud.account.block',   'Block or unblock accounts'),
  ('audit.view',            'View the audit trail'),
  ('admin.users.view',      'View application users'),
  ('admin.users.manage',    'Create users and change roles / activation');

-- Analyst: day-to-day investigation work (read + reverse, no configuration).
INSERT INTO role_permissions (role, permission_key)
SELECT 'analyst', permission_key FROM permissions
WHERE permission_key IN (
  'dashboard.view',
  'fraud.queue.view',
  'fraud.txn.reverse',
  'fraud.rules.view',
  'fraud.rings.view',
  'fraud.risk.view',
  'fraud.blacklist.view',
  'audit.view'
);

-- Admin: superset of Analyst plus configuration and user administration.
INSERT INTO role_permissions (role, permission_key)
SELECT 'admin', permission_key FROM permissions;
