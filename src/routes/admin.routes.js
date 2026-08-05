const router = require('express').Router();
const { v4: uuidv4 } = require('uuid');
const pool   = require('../database/db');
const { authenticate, requireRole } = require('../middleware/auth');

// ─── POST /admin/bootstrap — créer le premier compte ADMIN ───────────────────
// Doit être AVANT le middleware authenticate pour être accessible sans token
// Sécurisé par : secret + vérification q'aucun admin n'existe déjà
router.post('/bootstrap', async (req, res next) => {
  try {
    // Vérifie le secret (env var ou valeur par défaut)
    const expectedSecret = process.env.ADMIN_BOOTSTRAP_SECRET || 'medoq-bootstrap-2024';
    const secret = req.headers['x-admin-bootstrap'];
    if (secret !== expectedSecret) {
      return res.status(403).json({ success: false, message: 'Secret invalide' });
    }

    // Vérifie qu'aucun admin n'existe déjà
    const { rows: existing } = await pool.query("SELECT id FROM users WHERE role='ADMIN' LIMIT 1");
    if (existing.length > 0) {
      return res.status(409).json({ success: false, message: 'Un compte admin existe déjà. Bootstrap désactivé.' });
    }

    const { phone, name, password } = req.body;
    if (!phone || !password) {
      return res.status(400).json({ success: false, message: 'phone et password requis' });
    }

    const bcrypt = require('bcryptjs');
    const hash = await bcrypt.hash(password, 10);
    const id = uuidv4();
    await pool.query(
      "INSERT INTO users (id, phone, name, password_hash, role, is_active) VALUES ($1,$2,$3,$4,'ADMIN',1) ON CONFLICT (phone) DO UPDATE SET role='ADMIN', is_active=1",
      [id, phone, name || 'Admin Medoq', hash]
    );
    res.json({ success: true, message: 'Compte admin créé. Connectez-vous avec ce numéro.' });
  } catch (err) {
    console.error('[BOOTSTRAP ERROR]', err);
    return res.status(500).json({ success: false, message: err.message || String(err) });
  }
});

// Toutes les routes suivantes exigent un token ADMIN
router.use(authenticate, requireRole('ADMIN'));

// ─── GET /admin/pharmacies/pending — liste les pharmacies en attente ──────────
router.get('/pharmacies/pending', async (req, res, next) => {
  try {
    const { rows } = await pool.query(`
      SELECT p.*, u.name as staff_name, u.phone as staff_phone, u.email as staff_email
      FROM pharmacies p
      LEFT JOIN pharmacy_users pu ON pu.pharmacy_id = p.id
      LEFT JOIN users u ON u.id = pu.user_id
      WHERE p.is_active = 0
      ORDER BY p.created_at DESC
    `);
    res.json({ success: true, data: rows, count: rows.length });
  } catch (err) { next(err); }
});

// ─── GET /admin/pharmacies — liste toutes les pharmacies ─────────────────────
router.get('/pharmacies', async (req, res, next) => {
  try {
    const { rows } = await pool.query(`
      SELECT p.*, u.name as staff_name, u.phone as staff_phone
      FROM pharmacies p
      LEFT JOIN pharmacy_users pu ON pu.pharmacy_id = p.id
      LEFT JOIN users u ON u.id = pu.user_id
      ORDER BY p.created_at DESC
    `);
    res.json({ success: true, data: rows, count: rows.length });
  } catch (err) { next(err); }
});

// ─── PUT /admin/pharmacies/:id/activate — activer une pharmacie ──────────────
router.put('/pharmacies/:id/activate', async (req, res, next) => {
  try {
    const { id } = req.params;
    const { rows } = await pool.query('SELECT * FROM pharmacies WHERE id=$1', [id]);
    if (!rows[0]) return res.status(404).json({ success: false, message: 'Pharmacie introuvable' });

    await pool.query(
      'UPDATE pharmacies SET is_active=1, is_verified=1 WHERE id=$1',
      [id]
    );
    // Activer aussi le compte du staff
    await pool.query(`
      UPDATE users SET is_active=1
      WHERE id IN (SELECT user_id FROM pharmacy_users WHERE pharmacy_id=$1)
    `, [id]);

    res.json({ success: true, message: `Pharmacie "${rows[0].name}" activée avec succès.` });
  } catch (err) { next(err); }
});

// ─── PUT /admin/pharmacies/:id/reject — rejeter une pharmacie ────────────────
router.put('/pharmacies/:id/reject', async (req, res, next) => {
  try {
    const { id } = req.params;
    const { rows } = await pool.query('SELECT name FROM pharmacies WHERE id=$1', [id]);
    if (!rows[0]) return res.status(404).json({ success: false, message: 'Pharmacie introuvable' });

    await pool.query('DELETE FROM pharmacy_users WHERE pharmacy_id=$1', [id]);
    await pool.query('DELETE FROM pharmacies WHERE id=$1', [id]);

    res.json({ success: true, message: `Pharmacie "${rows[0].name}" supprimée.` });
  } catch (err) { next(err); }
});

// ─── GET /admin/stats — tableau de bord stats ────────────────────────────────
router.get('/stats', async (req, res, next) => {
  try {
    const [users, pharmacies, pending, reservations] = await Promise.all([
      pool.query('SELECT COUNT(*) as cnt FROM users WHERE role=\'PATIENT\''),
      pool.query('SELECT COUNT(*) as cnt FROM pharmacies WHERE is_active=1'),
      pool.query('SELECT COUNT(*) as cnt FROM pharmacies WHERE is_active=0'),
      pool.query('SELECT COUNT(*) as cnt FROM reservations'),
    ]);
    res.json({
      success: true,
      data: {
        patients:          parseInt(users.rows[0].cnt),
        pharmaciesActives: parseInt(pharmacies.rows[0].cnt),
        pharmaciesEnAttente: parseInt(pending.rows[0].cnt),
        reservations:      parseInt(reservations.rows[0].cnt),
      }
    });
  } catch (err) { next(err); }
});

module.exports = router;
