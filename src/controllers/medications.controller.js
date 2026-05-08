const db = require('../database/db');

// ─── GET /medications?q=&category=&page=&limit= ───────────────────────────────
function search(req, res, next) {
  try {
    const { q = '', category = '', page = 1, limit = 20 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    let sql    = 'SELECT * FROM medications WHERE is_active=1';
    const args = [];

    if (q) {
      sql += ' AND (LOWER(name) LIKE ? OR LOWER(dci) LIKE ?)';
      args.push(`%${q.toLowerCase()}%`, `%${q.toLowerCase()}%`);
    }
    if (category) {
      sql += ' AND LOWER(category) = ?';
      args.push(category.toLowerCase());
    }
    if (req.query.cmu === '1') {
      sql += ' AND is_cmu = 1';
    }

    const total = db.prepare(sql.replace('SELECT *', 'SELECT COUNT(*) as cnt')).get(...args).cnt;

    sql += ' ORDER BY name LIMIT ? OFFSET ?';
    args.push(parseInt(limit), offset);

    const meds = db.prepare(sql).all(...args);

    res.json({
      success: true,
      data: {
        medications: meds.map(medToDto),
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        totalPages: Math.ceil(total / parseInt(limit))
      }
    });
  } catch (err) { next(err); }
}

// ─── GET /medications/popular ─────────────────────────────────────────────────
function popular(req, res, next) {
  try {
    // Most reserved in last 30 days
    const meds = db.prepare(`
      SELECT m.*, COUNT(r.id) as reservation_count
      FROM medications m
      LEFT JOIN reservations r ON r.medication_id = m.id
        AND r.created_at > datetime('now', '-30 days')
      WHERE m.is_active = 1
      GROUP BY m.id
      ORDER BY reservation_count DESC, m.name ASC
      LIMIT 8
    `).all();

    res.json({ success: true, data: meds.map(medToDto) });
  } catch (err) { next(err); }
}

// ─── GET /medications/categories ─────────────────────────────────────────────
function categories(req, res, next) {
  try {
    const cats = db.prepare('SELECT DISTINCT category FROM medications WHERE is_active=1 AND category IS NOT NULL ORDER BY category').all();
    res.json({ success: true, data: cats.map(r => r.category) });
  } catch (err) { next(err); }
}

// ─── GET /medications/cmu — CMU-reimbursed medications ───────────────────────
function cmuList(req, res, next) {
  try {
    const meds = db.prepare('SELECT * FROM medications WHERE is_active=1 AND is_cmu=1 ORDER BY name').all();
    res.json({ success: true, data: meds.map(medToDto) });
  } catch (err) { next(err); }
}

// ─── GET /medications/:id ─────────────────────────────────────────────────────
function getById(req, res, next) {
  try {
    const med = db.prepare('SELECT * FROM medications WHERE id=? AND is_active=1').get(req.params.id);
    if (!med) return res.status(404).json({ success: false, message: 'Médicament introuvable' });

    // Also return pharmacies that have it in stock
    const stock = db.prepare(`
      SELECT ps.*, p.name as pharmacy_name, p.address, p.latitude, p.longitude, p.phone, p.opening_hours, p.rating
      FROM pharmacy_stock ps
      JOIN pharmacies p ON p.id = ps.pharmacy_id
      WHERE ps.medication_id = ? AND ps.quantity > 0 AND p.is_active = 1
      ORDER BY ps.price ASC
    `).all(req.params.id);

    res.json({ success: true, data: { ...medToDto(med), availableAt: stock } });
  } catch (err) { next(err); }
}

// ─── Admin: POST /medications ─────────────────────────────────────────────────
function create(req, res, next) {
  try {
    const { v4: uuidv4 } = require('uuid');
    const { name, dci, form, dosage, category, requires_prescription, description } = req.body;
    const id = uuidv4();
    db.prepare('INSERT INTO medications (id, name, dci, form, dosage, category, requires_prescription, description) VALUES (?,?,?,?,?,?,?,?)')
      .run(id, name, dci||null, form||null, dosage||null, category||null, requires_prescription?1:0, description||null);
    const med = db.prepare('SELECT * FROM medications WHERE id=?').get(id);
    res.status(201).json({ success: true, data: medToDto(med) });
  } catch (err) { next(err); }
}

// ─── DTO ──────────────────────────────────────────────────────────────────────
function medToDto(m) {
  return {
    id:                   m.id,
    name:                 m.name,
    dci:                  m.dci,
    form:                 m.form,
    dosage:               m.dosage,
    category:             m.category,
    requiresPrescription: !!m.requires_prescription,
    isCmu:                !!m.is_cmu,
    description:          m.description,
    isActive:             !!m.is_active,
    createdAt:            m.created_at,
  };
}

module.exports = { search, popular, categories, cmuList, getById, create };
