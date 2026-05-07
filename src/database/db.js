const Database = require('better-sqlite3');
const path = require('path');
require('dotenv').config();

const DB_PATH = process.env.DB_PATH || './medoq.db';
const db = new Database(path.resolve(DB_PATH));

// Performance settings
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ─── SCHEMA ──────────────────────────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    phone TEXT UNIQUE NOT NULL,
    email TEXT UNIQUE,
    name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'PATIENT',
    is_active INTEGER NOT NULL DEFAULT 1,
    is_blocked INTEGER NOT NULL DEFAULT 0,
    failed_login_attempts INTEGER NOT NULL DEFAULT 0,
    blocked_until TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS medications (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    dci TEXT,
    form TEXT,
    dosage TEXT,
    category TEXT,
    requires_prescription INTEGER NOT NULL DEFAULT 0,
    description TEXT,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS pharmacies (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    address TEXT NOT NULL,
    latitude REAL NOT NULL,
    longitude REAL NOT NULL,
    phone TEXT NOT NULL,
    opening_hours TEXT,
    is_active INTEGER NOT NULL DEFAULT 1,
    is_verified INTEGER NOT NULL DEFAULT 0,
    description TEXT,
    license_number TEXT UNIQUE,
    rating REAL DEFAULT 0,
    review_count INTEGER DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS pharmacy_users (
    id TEXT PRIMARY KEY,
    pharmacy_id TEXT NOT NULL REFERENCES pharmacies(id),
    user_id TEXT NOT NULL REFERENCES users(id),
    role TEXT NOT NULL DEFAULT 'PHARMACY_STAFF',
    is_active INTEGER NOT NULL DEFAULT 1,
    UNIQUE(pharmacy_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS pharmacy_stock (
    id TEXT PRIMARY KEY,
    pharmacy_id TEXT NOT NULL REFERENCES pharmacies(id),
    medication_id TEXT NOT NULL REFERENCES medications(id),
    quantity INTEGER NOT NULL DEFAULT 0,
    price REAL NOT NULL,
    threshold INTEGER DEFAULT 5,
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(pharmacy_id, medication_id)
  );

  CREATE TABLE IF NOT EXISTS reservations (
    id TEXT PRIMARY KEY,
    ref_number TEXT UNIQUE NOT NULL,
    patient_id TEXT NOT NULL REFERENCES users(id),
    pharmacy_id TEXT NOT NULL REFERENCES pharmacies(id),
    medication_id TEXT NOT NULL REFERENCES medications(id),
    quantity INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'CONFIRMED',
    expires_at TEXT NOT NULL,
    total_amount REAL NOT NULL,
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS payments (
    id TEXT PRIMARY KEY,
    reservation_id TEXT UNIQUE NOT NULL REFERENCES reservations(id),
    method TEXT NOT NULL,
    amount REAL NOT NULL,
    commission REAL DEFAULT 0,
    commission_rate REAL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'PENDING',
    wave_ref TEXT,
    orange_ref TEXT,
    checkout_url TEXT,
    failure_reason TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    completed_at TEXT
  );

  CREATE TABLE IF NOT EXISTS refresh_tokens (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    token TEXT UNIQUE NOT NULL,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_reservations_patient ON reservations(patient_id);
  CREATE INDEX IF NOT EXISTS idx_reservations_pharmacy ON reservations(pharmacy_id);
  CREATE INDEX IF NOT EXISTS idx_reservations_status ON reservations(status);
  CREATE INDEX IF NOT EXISTS idx_stock_pharmacy ON pharmacy_stock(pharmacy_id);
  CREATE INDEX IF NOT EXISTS idx_stock_medication ON pharmacy_stock(medication_id);
`);

// ─── Migrations (safe to run multiple times) ──────────────────────────────────
try { db.exec("ALTER TABLE reservations ADD COLUMN delivery_type TEXT NOT NULL DEFAULT 'PICKUP'"); } catch(_) {}
try { db.exec("ALTER TABLE reservations ADD COLUMN delivery_address TEXT");                       } catch(_) {}
try { db.exec("ALTER TABLE reservations ADD COLUMN delivery_fee REAL NOT NULL DEFAULT 0");        } catch(_) {}

module.exports = db;
