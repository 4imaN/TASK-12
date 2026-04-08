-- ============================================================
-- RailOps Offline Schedule & Inventory Control Suite
-- MySQL 8.0 Database Schema
-- ============================================================

SET NAMES utf8mb4;
SET CHARACTER SET utf8mb4;

CREATE DATABASE IF NOT EXISTS railops
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE railops;

-- ────────────────────────────────────────────
-- Users & Authentication
-- ────────────────────────────────────────────

CREATE TABLE users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  username VARCHAR(100) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  display_name VARCHAR(200),
  phone_encrypted VARCHAR(255),
  phone_last4 VARCHAR(4),
  role ENUM('guest','host','platform_ops') NOT NULL DEFAULT 'guest',
  is_active BOOLEAN DEFAULT TRUE,
  max_sessions INT DEFAULT 2,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE sessions (
  id VARCHAR(128) PRIMARY KEY,
  user_id INT NOT NULL,
  device_fingerprint VARCHAR(255),
  ip_address VARCHAR(45),
  state VARCHAR(30) NOT NULL DEFAULT 'active',
  last_active_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  expires_at TIMESTAMP NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE trusted_devices (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  device_fingerprint VARCHAR(255) NOT NULL,
  browser_info VARCHAR(255),
  os_info VARCHAR(100),
  trusted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id),
  UNIQUE KEY uq_user_device (user_id, device_fingerprint)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE recovery_codes (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  code_hash VARCHAR(255) NOT NULL,
  is_used BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  used_at TIMESTAMP NULL,
  FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE login_attempts (
  id INT AUTO_INCREMENT PRIMARY KEY,
  username VARCHAR(100) NOT NULL,
  ip_address VARCHAR(45),
  device_fingerprint VARCHAR(255),
  success BOOLEAN DEFAULT FALSE,
  failure_reason VARCHAR(100),
  attempted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_username_time (username, attempted_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE lockouts (
  id INT AUTO_INCREMENT PRIMARY KEY,
  username VARCHAR(100) NOT NULL,
  locked_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  unlocked_at TIMESTAMP NULL,
  unlock_reason VARCHAR(255),
  unlocked_by INT NULL,
  lockout_count_24h INT DEFAULT 1,
  requires_admin_reset BOOLEAN DEFAULT FALSE,
  FOREIGN KEY (unlocked_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE session_exceptions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  granted_by INT NOT NULL,
  max_sessions INT NOT NULL,
  reason VARCHAR(500),
  expires_at TIMESTAMP NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (granted_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE user_station_scopes (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  station_id INT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id),
  UNIQUE KEY uq_user_station (user_id, station_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ────────────────────────────────────────────
-- Stations
-- ────────────────────────────────────────────

CREATE TABLE stations (
  id INT AUTO_INCREMENT PRIMARY KEY,
  code VARCHAR(10) UNIQUE NOT NULL,
  name VARCHAR(200) NOT NULL,
  name_normalized VARCHAR(200) NOT NULL,
  region VARCHAR(100),
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE station_aliases (
  id INT AUTO_INCREMENT PRIMARY KEY,
  station_id INT NOT NULL,
  alias VARCHAR(200) NOT NULL,
  alias_normalized VARCHAR(200) NOT NULL,
  FOREIGN KEY (station_id) REFERENCES stations(id),
  INDEX idx_alias_norm (alias_normalized)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ────────────────────────────────────────────
-- Trainsets
-- ────────────────────────────────────────────

CREATE TABLE trainsets (
  id INT AUTO_INCREMENT PRIMARY KEY,
  code VARCHAR(50) UNIQUE NOT NULL,
  name VARCHAR(200),
  total_capacity INT,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ────────────────────────────────────────────
-- Schedules & Versioning
-- ────────────────────────────────────────────

CREATE TABLE schedules (
  id INT AUTO_INCREMENT PRIMARY KEY,
  station_id INT NOT NULL,
  route_name VARCHAR(200),
  trainset_id INT,
  active_version_id INT NULL,
  created_by INT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (station_id) REFERENCES stations(id),
  FOREIGN KEY (trainset_id) REFERENCES trainsets(id),
  FOREIGN KEY (created_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE schedule_versions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  schedule_id INT NOT NULL,
  version_number INT NOT NULL,
  status ENUM('draft','pending_approval','approved','published','rejected','archived') DEFAULT 'draft',
  trainset_id INT,
  effective_at TIMESTAMP NULL,
  published_at TIMESTAMP NULL,
  created_by INT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  notes TEXT,
  rollback_source_version_id INT NULL,
  FOREIGN KEY (schedule_id) REFERENCES schedules(id),
  FOREIGN KEY (trainset_id) REFERENCES trainsets(id),
  FOREIGN KEY (created_by) REFERENCES users(id),
  UNIQUE KEY uq_schedule_version (schedule_id, version_number)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Add FK from schedules.active_version_id now that schedule_versions exists
ALTER TABLE schedules ADD FOREIGN KEY (active_version_id) REFERENCES schedule_versions(id);

CREATE TABLE schedule_stops (
  id INT AUTO_INCREMENT PRIMARY KEY,
  version_id INT NOT NULL,
  station_id INT NOT NULL,
  stop_sequence INT NOT NULL,
  arrival_at DATETIME NULL,
  departure_at DATETIME NOT NULL,
  platform VARCHAR(20),
  FOREIGN KEY (version_id) REFERENCES schedule_versions(id) ON DELETE CASCADE,
  FOREIGN KEY (station_id) REFERENCES stations(id),
  UNIQUE KEY uq_version_sequence (version_id, stop_sequence)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE seat_classes (
  id INT AUTO_INCREMENT PRIMARY KEY,
  version_id INT NOT NULL,
  class_code VARCHAR(20) NOT NULL,
  class_name VARCHAR(100) NOT NULL,
  capacity INT NOT NULL,
  fare DECIMAL(7,2) NOT NULL,
  is_available BOOLEAN DEFAULT TRUE,
  FOREIGN KEY (version_id) REFERENCES schedule_versions(id) ON DELETE CASCADE,
  CHECK (capacity >= 1 AND capacity <= 500),
  CHECK (fare >= 1.00 AND fare <= 999.00)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE approval_requests (
  id INT AUTO_INCREMENT PRIMARY KEY,
  version_id INT NOT NULL,
  requested_by INT NOT NULL,
  status ENUM('pending','approved','rejected') DEFAULT 'pending',
  reviewed_by INT NULL,
  review_comment TEXT,
  requested_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  reviewed_at TIMESTAMP NULL,
  FOREIGN KEY (version_id) REFERENCES schedule_versions(id),
  FOREIGN KEY (requested_by) REFERENCES users(id),
  FOREIGN KEY (reviewed_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ────────────────────────────────────────────
-- Inventory
-- ────────────────────────────────────────────

CREATE TABLE inventory_items (
  id INT AUTO_INCREMENT PRIMARY KEY,
  station_id INT NOT NULL,
  sku VARCHAR(50) UNIQUE NOT NULL,
  name VARCHAR(200) NOT NULL,
  description TEXT,
  unit VARCHAR(50) DEFAULT 'unit',
  unit_cost DECIMAL(10,2) DEFAULT 0.00,
  tracking_mode ENUM('none','batch','serial') DEFAULT 'none',
  reorder_point INT DEFAULT 20,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (station_id) REFERENCES stations(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE inventory_balances (
  id INT AUTO_INCREMENT PRIMARY KEY,
  item_id INT NOT NULL,
  station_id INT NOT NULL,
  on_hand INT DEFAULT 0,
  last_counted_at TIMESTAMP NULL,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (item_id) REFERENCES inventory_items(id),
  FOREIGN KEY (station_id) REFERENCES stations(id),
  UNIQUE KEY uq_item_station (item_id, station_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE inventory_movements (
  id INT AUTO_INCREMENT PRIMARY KEY,
  item_id INT NOT NULL,
  station_id INT NOT NULL,
  movement_type ENUM('receiving','shipping','material_return','customer_return','adjustment') NOT NULL,
  quantity INT NOT NULL,
  direction ENUM('in','out') NOT NULL,
  batch_number VARCHAR(100),
  reference_number VARCHAR(100),
  notes TEXT,
  performed_by INT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (item_id) REFERENCES inventory_items(id),
  FOREIGN KEY (station_id) REFERENCES stations(id),
  FOREIGN KEY (performed_by) REFERENCES users(id),
  INDEX idx_item_station_time (item_id, station_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE serial_records (
  id INT AUTO_INCREMENT PRIMARY KEY,
  movement_id INT NOT NULL,
  item_id INT NOT NULL,
  serial_number VARCHAR(100) NOT NULL,
  status ENUM('in_stock','shipped','returned','disposed') DEFAULT 'in_stock',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (movement_id) REFERENCES inventory_movements(id),
  FOREIGN KEY (item_id) REFERENCES inventory_items(id),
  INDEX idx_serial (item_id, serial_number)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE stock_counts (
  id INT AUTO_INCREMENT PRIMARY KEY,
  station_id INT NOT NULL,
  status ENUM('open','in_progress','finalized','cancelled') DEFAULT 'open',
  counted_by INT NOT NULL,
  finalized_by INT NULL,
  started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  finalized_at TIMESTAMP NULL,
  notes TEXT,
  FOREIGN KEY (station_id) REFERENCES stations(id),
  FOREIGN KEY (counted_by) REFERENCES users(id),
  FOREIGN KEY (finalized_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE stock_count_lines (
  id INT AUTO_INCREMENT PRIMARY KEY,
  stock_count_id INT NOT NULL,
  item_id INT NOT NULL,
  book_quantity INT NOT NULL,
  counted_quantity INT NOT NULL,
  variance_quantity INT GENERATED ALWAYS AS (counted_quantity - book_quantity) STORED,
  variance_cost DECIMAL(10,2),
  batch_number VARCHAR(100),
  serial_numbers JSON,
  FOREIGN KEY (stock_count_id) REFERENCES stock_counts(id) ON DELETE CASCADE,
  FOREIGN KEY (item_id) REFERENCES inventory_items(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ────────────────────────────────────────────
-- Backup & Recovery
-- ────────────────────────────────────────────

CREATE TABLE backups (
  id INT AUTO_INCREMENT PRIMARY KEY,
  backup_type ENUM('full','incremental') NOT NULL,
  file_path VARCHAR(500),
  file_size BIGINT,
  checksum VARCHAR(128),
  binlog_file_start VARCHAR(255) NULL,
  binlog_pos_start BIGINT NULL,
  binlog_file_end VARCHAR(255) NULL,
  binlog_pos_end BIGINT NULL,
  parent_backup_id INT NULL,
  status ENUM('running','completed','failed') DEFAULT 'running',
  started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  completed_at TIMESTAMP NULL,
  error_message TEXT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE backup_config (
  id INT AUTO_INCREMENT PRIMARY KEY,
  backup_path VARCHAR(500) NOT NULL DEFAULT '/backups',
  full_schedule VARCHAR(50) DEFAULT '0 2 * * *',
  incremental_interval_min INT DEFAULT 15,
  retention_days INT DEFAULT 90,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO backup_config (backup_path) VALUES ('/backups');

CREATE TABLE restore_drills (
  id INT AUTO_INCREMENT PRIMARY KEY,
  backup_id INT NOT NULL,
  status ENUM('running','passed','failed') DEFAULT 'running',
  scratch_schema VARCHAR(100),
  started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  completed_at TIMESTAMP NULL,
  report JSON,
  performed_by INT NOT NULL,
  FOREIGN KEY (backup_id) REFERENCES backups(id),
  FOREIGN KEY (performed_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ────────────────────────────────────────────
-- Data Quality
-- ────────────────────────────────────────────

CREATE TABLE data_quality_issues (
  id INT AUTO_INCREMENT PRIMARY KEY,
  entity_type VARCHAR(50) NOT NULL,
  entity_id INT,
  check_type ENUM('completeness','uniqueness','freshness','accuracy') NOT NULL,
  severity ENUM('low','medium','high','critical') DEFAULT 'medium',
  description TEXT NOT NULL,
  owner VARCHAR(100) NOT NULL DEFAULT 'platform_ops',
  due_date DATE NOT NULL,
  status ENUM('open','in_progress','resolved','dismissed') DEFAULT 'open',
  corrective_notes TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE data_quality_reports (
  id INT AUTO_INCREMENT PRIMARY KEY,
  report_date DATE NOT NULL,
  total_checks INT DEFAULT 0,
  passed_checks INT DEFAULT 0,
  failed_checks INT DEFAULT 0,
  issues_found INT DEFAULT 0,
  report_data JSON,
  generated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_report_date (report_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ────────────────────────────────────────────
-- Audit
-- ────────────────────────────────────────────

CREATE TABLE audit_logs (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  actor_id INT,
  actor_username VARCHAR(100),
  action VARCHAR(100) NOT NULL,
  entity_type VARCHAR(50),
  entity_id INT,
  details JSON,
  ip_address VARCHAR(45),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_entity (entity_type, entity_id),
  INDEX idx_actor_time (actor_id, created_at),
  INDEX idx_action_time (action, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ────────────────────────────────────────────
-- Corrective Actions (for backtracking)
-- ────────────────────────────────────────────

CREATE TABLE search_tracking (
  id INT AUTO_INCREMENT PRIMARY KEY,
  origin VARCHAR(200),
  destination VARCHAR(200),
  search_date VARCHAR(20),
  seat_class VARCHAR(50),
  search_count INT DEFAULT 1,
  last_searched_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_count (search_count DESC)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ────────────────────────────────────────────
-- Corrective Actions (for backtracking)
-- ────────────────────────────────────────────

CREATE TABLE corrective_actions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  entity_type VARCHAR(50) NOT NULL,
  entity_id INT,
  description TEXT NOT NULL,
  action_taken TEXT NOT NULL,
  performed_by INT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (performed_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
