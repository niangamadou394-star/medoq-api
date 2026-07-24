#!/usr/bin/env node
/**
 * Reset partiel de la base de production.
 *
 * Efface : pharmacies, stocks, staff pharmacie, reservations, paiements.
 * Garde  : catalogue medications, patients (users avec role = PATIENT), otp_codes, refresh_tokens.
 *
 * Usage :
 *   DATABASE_URL="postgresql://..." node scripts/reset-prod.js --i-know
 *
 * Le flag --i-know est obligatoire. Sans lui, le script affiche un dry-run
 * (liste ce qui serait supprime, ne touche rien).
 */

require('dotenv').config();
const { Pool } = require('pg');

const CONFIRM_FLAG = '--i-know';
const args = process.argv.slice(2);
const confirmed = args.includes(CONFIRM_FLAG);

if (!process.env.DATABASE_URL) {
  console.error('ERREUR : variable DATABASE_URL absente.');
  console.error('Exporte-la ou mets-la dans un fichier .env local (External Database URL depuis Render).');
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function count(sql) {
  const r = await pool.query(sql);
  return parseInt(r.rows[0].n, 10);
}

async function main() {
  console.log('Connexion a la base ...');
  const dbInfo = await pool.query('SELECT current_database() AS db, current_user AS usr');
  console.log(`Base : ${dbInfo.rows[0].db} | user : ${dbInfo.rows[0].usr}`);
  console.log('');

  const before = {
    pharmacies:     await count("SELECT COUNT(*) AS n FROM pharmacies"),
    stock:          await count("SELECT COUNT(*) AS n FROM pharmacy_stock"),
    pharmacy_users: await count("SELECT COUNT(*) AS n FROM pharmacy_users"),
    reservations:   await count("SELECT COUNT(*) AS n FROM reservations"),
    payments:       await count("SELECT COUNT(*) AS n FROM payments"),
    staff_users:    await count("SELECT COUNT(*) AS n FROM users WHERE role = 'PHARMACY_STAFF'"),
    patients:       await count("SELECT COUNT(*) AS n FROM users WHERE role = 'PATIENT'"),
    medications:    await count("SELECT COUNT(*) AS n FROM medications")
  };

  console.log('Etat actuel :');
  console.log(`  pharmacies      : ${before.pharmacies}`);
  console.log(`  pharmacy_stock  : ${before.stock}`);
  console.log(`  pharmacy_users  : ${before.pharmacy_users}`);
  console.log(`  reservations    : ${before.reservations}`);
  console.log(`  payments        : ${before.payments}`);
  console.log(`  users STAFF     : ${before.staff_users}  (a supprimer)`);
  console.log(`  users PATIENT   : ${before.patients}  (conserves)`);
  console.log(`  medications     : ${before.medications}  (conserves)`);
  console.log('');

  if (!confirmed) {
    console.log(`DRY-RUN. Aucune modification. Relance avec ${CONFIRM_FLAG} pour executer.`);
    await pool.end();
    return;
  }

  console.log('Execution du reset partiel ...');
  await pool.query('BEGIN');
  try {
    // TRUNCATE avec CASCADE va nettoyer pharmacy_users, pharmacy_stock, reservations, payments
    await pool.query('TRUNCATE pharmacies RESTART IDENTITY CASCADE');
    // Purge les comptes staff pharmacie qui n'ont plus de pharmacie associee
    await pool.query("DELETE FROM users WHERE role = 'PHARMACY_STAFF'");
    // Purge les tokens rafraichissement obsoletes lies aux users supprimes
    await pool.query("DELETE FROM refresh_tokens WHERE user_id NOT IN (SELECT id FROM users)");
    await pool.query('COMMIT');
    console.log('Reset OK.');
  } catch (e) {
    await pool.query('ROLLBACK');
    console.error('ERREUR, rollback effectue :', e.message);
    process.exit(1);
  }

  const after = {
    pharmacies:  await count("SELECT COUNT(*) AS n FROM pharmacies"),
    stock:       await count("SELECT COUNT(*) AS n FROM pharmacy_stock"),
    staff_users: await count("SELECT COUNT(*) AS n FROM users WHERE role = 'PHARMACY_STAFF'"),
    patients:    await count("SELECT COUNT(*) AS n FROM users WHERE role = 'PATIENT'"),
    medications: await count("SELECT COUNT(*) AS n FROM medications")
  };
  console.log('');
  console.log('Apres reset :');
  console.log(`  pharmacies      : ${after.pharmacies}`);
  console.log(`  pharmacy_stock  : ${after.stock}`);
  console.log(`  users STAFF     : ${after.staff_users}`);
  console.log(`  users PATIENT   : ${after.patients}`);
  console.log(`  medications     : ${after.medications}`);

  await pool.end();
}

main().catch(async (e) => {
  console.error('ERREUR :', e);
  await pool.end();
  process.exit(1);
});
