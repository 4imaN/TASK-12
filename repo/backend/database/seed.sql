-- ============================================================
-- RailOps Seed Data
-- ============================================================
-- NOTE: Password hashes below are PLACEHOLDERS.
-- In production, generate real bcrypt hashes with cost factor 12+.
-- Placeholder value represents the plain-text password shown in
-- the comment; replace before any non-local use.
-- ============================================================

USE railops;

-- ────────────────────────────────────────────
-- Users
-- ────────────────────────────────────────────
-- admin / admin123  (platform_ops)
-- IMPORTANT: Replace this placeholder with a real bcrypt hash of "admin123"
--   e.g.  SELECT '$2b$12$...' from your bcrypt tool
INSERT INTO users (username, password_hash, display_name, role, is_active, max_sessions)
VALUES (
  'admin',
  '$2b$12$ePiu8s0IaolVuvpL/mg78OfQe7wbQcQRD4VKY4xx23FrybPQEZJyS',
  'Platform Administrator',
  'platform_ops',
  TRUE,
  2
);

-- host1 / host123  (host)
INSERT INTO users (username, password_hash, display_name, role, is_active, max_sessions)
VALUES (
  'host1',
  '$2b$12$RhhU4L4xnv6aB4sAeJOa3.8G6mCF11OQiv15MEeN4riXw8TiZQ.Cy',
  'Station Host 1',
  'host',
  TRUE,
  2
);

-- Bootstrap trusted devices for seeded users
INSERT INTO trusted_devices (user_id, device_fingerprint, browser_info, os_info) VALUES
  (1, 'BOOTSTRAP_INITIAL_DEVICE', 'System Bootstrap', 'Initial Setup'),
  (2, 'TEST_DEVICE_host1', 'System Bootstrap', 'Initial Setup');

-- Admin session exception (max_sessions raised from default 2)
INSERT INTO session_exceptions (user_id, granted_by, max_sessions, reason) VALUES (1, 1, 100, 'Initial platform administrator bootstrap');
INSERT INTO session_exceptions (user_id, granted_by, max_sessions, reason) VALUES (2, 1, 100, 'Initial host bootstrap');

-- ────────────────────────────────────────────
-- Stations
-- ────────────────────────────────────────────

INSERT INTO stations (code, name, name_normalized, region) VALUES
  ('NYC', 'New York Penn Station',       'new york penn station',       'Northeast'),
  ('BOS', 'Boston South Station',        'boston south station',         'Northeast'),
  ('WAS', 'Washington Union Station',    'washington union station',    'Mid-Atlantic'),
  ('CHI', 'Chicago Union Station',       'chicago union station',       'Midwest'),
  ('PHL', 'Philadelphia 30th St Station','philadelphia 30th st station','Mid-Atlantic'),
  ('BAL', 'Baltimore Penn Station',      'baltimore penn station',      'Mid-Atlantic');

-- ────────────────────────────────────────────
-- Station Aliases
-- ────────────────────────────────────────────

-- NYC aliases
INSERT INTO station_aliases (station_id, alias, alias_normalized) VALUES
  (1, 'Penn Station',        'penn station'),
  (1, 'New York',            'new york'),
  (1, 'NYP',                 'nyp');

-- BOS aliases
INSERT INTO station_aliases (station_id, alias, alias_normalized) VALUES
  (2, 'South Station',       'south station'),
  (2, 'Boston',              'boston'),
  (2, 'BOS',                 'bos');

-- WAS aliases
INSERT INTO station_aliases (station_id, alias, alias_normalized) VALUES
  (3, 'Union Station DC',    'union station dc'),
  (3, 'Washington DC',       'washington dc'),
  (3, 'WAS',                 'was');

-- CHI aliases
INSERT INTO station_aliases (station_id, alias, alias_normalized) VALUES
  (4, 'Union Station Chicago','union station chicago'),
  (4, 'Chicago',              'chicago'),
  (4, 'CHI',                  'chi');

-- PHL aliases
INSERT INTO station_aliases (station_id, alias, alias_normalized) VALUES
  (5, '30th Street Station',  '30th street station'),
  (5, 'Philadelphia',         'philadelphia'),
  (5, 'PHL',                  'phl');

-- BAL aliases
INSERT INTO station_aliases (station_id, alias, alias_normalized) VALUES
  (6, 'Penn Station Baltimore','penn station baltimore'),
  (6, 'Baltimore',             'baltimore'),
  (6, 'BAL',                   'bal');

-- ────────────────────────────────────────────
-- Trainsets
-- ────────────────────────────────────────────

-- Assign host1 (user 2) to NYC (station 1) and BOS (station 2)
INSERT INTO user_station_scopes (user_id, station_id) VALUES (2, 1), (2, 2);

-- ────────────────────────────────────────────
-- Trainsets
-- ────────────────────────────────────────────

INSERT INTO trainsets (code, name, total_capacity) VALUES
  ('ACELA-2100', 'Acela Express 2100', 304),
  ('NER-4400',   'Northeast Regional 4400', 520);

-- ────────────────────────────────────────────
-- Sample Published Schedule
-- ────────────────────────────────────────────

INSERT INTO schedules (station_id, route_name, trainset_id, created_by)
VALUES (1, 'Northeast Corridor Express', 1, 1);

INSERT INTO schedule_versions (schedule_id, version_number, status, trainset_id, effective_at, published_at, created_by)
VALUES (1, 1, 'published', 1, NOW(), NOW(), 1);

UPDATE schedules SET active_version_id = 1 WHERE id = 1;

INSERT INTO schedule_stops (version_id, station_id, stop_sequence, departure_at) VALUES
  (1, 1, 1, '2026-04-10 08:00:00');
INSERT INTO schedule_stops (version_id, station_id, stop_sequence, arrival_at, departure_at) VALUES
  (1, 5, 2, '2026-04-10 09:15:00', '2026-04-10 09:20:00'),
  (1, 3, 3, '2026-04-10 11:30:00', '2026-04-10 11:30:00');

INSERT INTO seat_classes (version_id, class_code, class_name, capacity, fare, is_available) VALUES
  (1, 'ECO', 'Economy',      200,  49.00, TRUE),
  (1, 'BIZ', 'Business',      80, 129.00, TRUE),
  (1, 'FIR', 'First Class',   24, 299.00, TRUE);

-- ────────────────────────────────────────────
-- Sample Inventory
-- ────────────────────────────────────────────

INSERT INTO inventory_items (station_id, sku, name, unit, unit_cost, tracking_mode, reorder_point) VALUES
  (1, 'WATER-500ML',  'Water Bottle 500ml',     'bottle', 0.50,  'none',   50),
  (1, 'SNACK-MIX',    'Trail Mix Pack',          'pack',   2.00,  'batch',  30),
  (1, 'RADIO-HH',     'Handheld Radio',          'unit',   150.00,'serial', 5),
  (2, 'MEDKIT-STD',   'Standard Medical Kit',    'kit',    75.00, 'serial', 3),
  (1, 'BLANKET-ECO',  'Economy Blanket',         'piece',  8.00,  'none',   20);

INSERT INTO inventory_balances (item_id, station_id, on_hand) VALUES
  (1, 1, 100),
  (2, 1, 45),
  (3, 1, 8),
  (4, 2, 4),
  (5, 1, 15);
