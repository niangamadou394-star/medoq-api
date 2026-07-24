#!/usr/bin/env node
/**
 * Onboarding d'une officine pilote Medoq
 *
 * Crée une vraie pharmacie, son compte pharmacien et, si fourni, son stock initial.
 * À exécuter avec DATABASE_URL pointant vers la base de production (Render).
 *
 * Usage :
 *   node scripts/onboard-pharmacy.js \
 *     --name "Pharmacie Centrale du Plateau" \
 *     --address "Av. L. S. Senghor, Plateau, Dakar" \
 *     --lat 14.6892 --lng -17.4443 \
 *     --phone "+221338234567" \
 *     --hours "08h - 20h" \
 *     --license "PH-DK-011" \
 *     --staff-name "Dr Awa Ndiaye" \
 *     --staff-phone "+221771234567" \
 *     --staff-email "awa.ndiaye@example.com" \
 *     --staff-password "MotDePasseSolide2026" \
 *     --stock stock.csv
 *
 * --staff-email est optionnel. S'il est fourni, le pharmacien peut se
 * connecter avec son numero OU son email.
 *
 * Format du CSV de stock (séparateur ; ou ,) :
 *   medicament;quantite;prix
 *   Paracetamol 500mg;40;1500
 *   Amoxicilline 500mg;25;3200
 *
 * Le médicament est recherché par nom (insensible à la casse). S'il n'existe
 * pas encore dans le catalogue, il est créé automatiquement (sans ordonnance
 * par défaut, à ajuster ensuite dans le tableau de bord).
 */
require('dotenv').config();
const fs = require('fs');
const bcrypt = require('bcrypt');
const { v4: uuidv4 } = require('uuid');
const pool = require('../src/database/db');

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      const key = argv[i].slice(2);
      args[key] = argv[i + 1];
      i++;
    }
  }
  return args;
}

function fail(msg) {
  console.error(`❌ ${msg}`);
  process.exit(1);
}

async function main() {
  const a = parseArgs(process.argv);

  const required = ['name', 'address', 'lat', 'lng', 'phone', 'license', 'staff-name', 'staff-phone', 'staff-password'];
  for (const r of required) {
    if (!a[r]) fail(`Argument manquant : --${r}`);
  }
  if (a['staff-password'].length < 8) fail('Le mot de passe doit faire au moins 8 caractères');
  if (a['staff-email'] && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(a['staff-email'])) {
    fail(`Email pharmacien invalide : ${a['staff-email']}`);
  }
  const staffEmail = a['staff-email'] ? a['staff-email'].toLowerCase() : null;

  await pool.initDb();

  // ─── Pharmacie ──────────────────────────────────────────────────────────────
  const { rows: existingPh } = await pool.query('SELECT id, name FROM pharmacies WHERE license_number=$1', [a.license]);
  let pharmacyId;
  if (existingPh[0]) {
    pharmacyId = existingPh[0].id;
    console.log(`ℹ️  Pharmacie déjà enregistrée (${existingPh[0].name}), réutilisation.`);
  } else {
    pharmacyId = uuidv4();
    await pool.query(
      `INSERT INTO pharmacies (id, name, address, latitude, longitude, phone, opening_hours, is_active, is_verified, license_number)
       VALUES ($1,$2,$3,$4,$5,$6,$7,1,1,$8)`,
      [pharmacyId, a.name, a.address, parseFloat(a.lat), parseFloat(a.lng), a.phone, a.hours || '08h - 20h', a.license]
    );
    console.log(`✅ Pharmacie créée : ${a.name} (${a.license})`);
  }

  // ─── Compte pharmacien ──────────────────────────────────────────────────────
  const { rows: existingUser } = await pool.query('SELECT id, name, email FROM users WHERE phone=$1', [a['staff-phone']]);
  let userId;
  if (existingUser[0]) {
    userId = existingUser[0].id;
    console.log(`ℹ️  Compte existant pour ${a['staff-phone']} (${existingUser[0].name}), réutilisation.`);
    // Renseigne l'email si fourni et absent en base
    if (staffEmail && !existingUser[0].email) {
      await pool.query('UPDATE users SET email=$1 WHERE id=$2', [staffEmail, userId]);
      console.log(`   Email ajouté au compte : ${staffEmail}`);
    }
  } else {
    userId = uuidv4();
    const hash = await bcrypt.hash(a['staff-password'], 10);
    await pool.query(
      `INSERT INTO users (id, phone, email, name, password_hash, role) VALUES ($1,$2,$3,$4,$5,'PHARMACY_STAFF')`,
      [userId, a['staff-phone'], staffEmail, a['staff-name'], hash]
    );
    console.log(`✅ Compte pharmacien créé : ${a['staff-name']} (${a['staff-phone']}${staffEmail ? ' / ' + staffEmail : ''})`);
  }

  // ─── Lien pharmacien ↔ pharmacie ────────────────────────────────────────────
  await pool.query(
    `INSERT INTO pharmacy_users (id, pharmacy_id, user_id)
     VALUES ($1,$2,$3) ON CONFLICT (pharmacy_id, user_id) DO NOTHING`,
    [uuidv4(), pharmacyId, userId]
  );
  console.log('✅ Pharmacien rattaché à la pharmacie');

  // ─── Stock initial (optionnel) ──────────────────────────────────────────────
  if (a.stock) {
    if (!fs.existsSync(a.stock)) fail(`Fichier stock introuvable : ${a.stock}`);
    const lines = fs.readFileSync(a.stock, 'utf-8').split('\n').map(l => l.trim()).filter(Boolean);
    let ok = 0, created = 0;

    for (const line of lines) {
      const parts = line.split(/[;,]/).map(s => s.trim());
      if (parts.length < 3) continue;
      const [medName, qtyStr, priceStr] = parts;
      const qty = parseInt(qtyStr), price = parseFloat(priceStr);
      if (isNaN(qty) || isNaN(price)) continue; // ligne d'en-tête ou invalide

      let { rows: medRows } = await pool.query(
        'SELECT id FROM medications WHERE LOWER(name)=LOWER($1) AND is_active=1', [medName]
      );
      let medId = medRows[0]?.id;
      if (!medId) {
        medId = uuidv4();
        await pool.query(
          `INSERT INTO medications (id, name, requires_prescription) VALUES ($1,$2,0)`,
          [medId, medName]
        );
        created++;
        console.log(`  ➕ Médicament ajouté au catalogue : ${medName}`);
      }

      await pool.query(
        `INSERT INTO pharmacy_stock (id, pharmacy_id, medication_id, quantity, price)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (pharmacy_id, medication_id)
         DO UPDATE SET quantity=EXCLUDED.quantity, price=EXCLUDED.price, updated_at=EXCLUDED.updated_at`,
        [uuidv4(), pharmacyId, medId, qty, price]
      );
      ok++;
    }
    console.log(`✅ Stock chargé : ${ok} lignes (${created} nouveaux médicaments au catalogue)`);
  }

  console.log('\nOnboarding terminé.');
  console.log(`   Connexion pharmacien : ${a['staff-phone']}${staffEmail ? ' ou ' + staffEmail : ''} / mot de passe choisi`);
  console.log('   Le tableau de bord est accessible après connexion dans l\'application.');
  await pool.end();
}

main().catch(err => { console.error('❌ Erreur :', err.message); process.exit(1); });
