const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

pool.on('error', (err) => {
  console.error('Unexpected PostgreSQL pool error:', err.message);
});

// ─── SCHEMA INIT ─────────────────────────────────────────────────────────────
async function initDb() {
  await pool.query(`
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
      created_at TEXT NOT NULL DEFAULT TO_CHAR(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
      updated_at TEXT NOT NULL DEFAULT TO_CHAR(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
    );

    CREATE TABLE IF NOT EXISTS otp_codes (
      id TEXT PRIMARY KEY,
      phone TEXT NOT NULL,
      code TEXT NOT NULL,
      purpose TEXT NOT NULL DEFAULT 'REGISTER',
      expires_at TEXT NOT NULL,
      used INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT TO_CHAR(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
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
      is_cmu INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT TO_CHAR(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
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
      created_at TEXT NOT NULL DEFAULT TO_CHAR(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
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
      updated_at TEXT NOT NULL DEFAULT TO_CHAR(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
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
      delivery_type TEXT NOT NULL DEFAULT 'PICKUP',
      delivery_address TEXT,
      delivery_fee REAL NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT TO_CHAR(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
      updated_at TEXT NOT NULL DEFAULT TO_CHAR(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
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
      created_at TEXT NOT NULL DEFAULT TO_CHAR(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
      completed_at TEXT
    );

    CREATE TABLE IF NOT EXISTS refresh_tokens (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id),
      token TEXT UNIQUE NOT NULL,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT TO_CHAR(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
    );

    CREATE INDEX IF NOT EXISTS idx_reservations_patient   ON reservations(patient_id);
    CREATE INDEX IF NOT EXISTS idx_reservations_pharmacy  ON reservations(pharmacy_id);
    CREATE INDEX IF NOT EXISTS idx_reservations_status    ON reservations(status);
    CREATE INDEX IF NOT EXISTS idx_stock_pharmacy         ON pharmacy_stock(pharmacy_id);
    CREATE INDEX IF NOT EXISTS idx_stock_medication       ON pharmacy_stock(medication_id);
    CREATE INDEX IF NOT EXISTS idx_otp_phone              ON otp_codes(phone);
  `);

  console.log('✅ PostgreSQL schema ready');
}

pool.initDb = initDb;

module.exports = pool;
