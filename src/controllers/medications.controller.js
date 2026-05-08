const { v4: uuidv4 } = require('uuid');
const pool = require('../database/db');

// ─── GET /medications?q=&category=&cmu=&page=&limit= ─────────────────────────
async function search(req, res, next) {
  try {
    const { q = '', category = '', page = 1, limit = 20 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    let sql    = 'SELECT * FROM medications WHERE is_active=1';
    const args = [];
    let idx    = 1;

    if (q) {
      sql += ` AND (LOWER(name) LIKE $${idx} OR LOWER(dci) LIKE $${idx + 1})`;
      args.push(`%${q.toLowerCase()}%`, `%${q.toLowerCase()}%`);
      idx += 2;
    }
    if (category) {
      sql += ` AND LOWER(category) = $${idx}`;
      args.push(category.toLowerCase());
      idx++;
    }
    if (req.query.cmu === '1') {
      sql += ' AND is_cmu = 1';
    }

    const countSql = sql.replace('SELECT *', 'SELECT COUNT(*) as cnt');
    const { rows: countRows } = await pool.query(countSql, args);
    const total = parseInt(countRows[0].cnt);

    sql += ` ORDER BY name LIMIT $${idx} OFFSET $${idx + 1}`;
    args.push(parseInt(limit), offset);

    const { rows: meds } = await pool.query(sql, args);

    res.json({
      success: true,
      data: {
        medications: meds.map(medToDto),
        total,
        page:       parseInt(page),
        limit:      parseInt(limit),
        totalPages: Math.ceil(total / parseInt(limit)),
      }
    });
  } catch (err) { next(err); }
}

// ─── GET /medications/popular ─────────────────────────────────────────────────
async function popular(req, res, next) {
  try {
    const { rows } = await pool.query(`
      SELECT m.*, COUNT(r.id) as reservation_count
      FROM medications m
      LEFT JOIN reservations r ON r.medication_id = m.id
        AND r.created_at > TO_CHAR(NOW() - INTERVAL '30 days' AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
      WHERE m.is_active = 1
      GROUP BY m.id
      ORDER BY reservation_count DESC, m.name ASC
      LIMIT 8
    `);
    res.json({ success: true, data: rows.map(medToDto) });
  } catch (err) { next(err); }
}

// ─── GET /medications/categories ─────────────────────────────────────────────
async function categories(req, res, next) {
  try {
    const { rows } = await pool.query(
      'SELECT DISTINCT category FROM medications WHERE is_active=1 AND category IS NOT NULL ORDER BY category'
    );
    res.json({ success: true, data: rows.map(r => r.category) });
  } catch (err) { next(err); }
}

// ─── GET /medications/cmu ─────────────────────────────────────────────────────
async function cmuList(req, res, next) {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM medications WHERE is_active=1 AND is_cmu=1 ORDER BY name'
    );
    res.json({ success: true, data: rows.map(medToDto) });
  } catch (err) { next(err); }
}

// ─── GET /medications/:id ─────────────────────────────────────────────────────
async function getById(req, res, next) {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM medications WHERE id=$1 AND is_active=1',
      [req.params.id]
    );
    const med = rows[0];
    if (!med) return res.status(404).json({ success: false, message: 'Médicament introuvable' });

    const { rows: stock } = await pool.query(`
      SELECT ps.*, p.name as pharmacy_name, p.address, p.latitude, p.longitude, p.phone, p.opening_hours, p.rating
      FROM pharmacy_stock ps
      JOIN pharmacies p ON p.id = ps.pharmacy_id
      WHERE ps.medication_id = $1 AND ps.quantity > 0 AND p.is_active = 1
      ORDER BY ps.price ASC
    `, [req.params.id]);

    res.json({ success: true, data: { ...medToDto(med), availableAt: stock } });
  } catch (err) { next(err); }
}

// ─── Admin: POST /medications ─────────────────────────────────────────────────
async function create(req, res, next) {
  try {
    const { name, dci, form, dosage, category, requires_prescription, description } = req.body;
    const id = uuidv4();
    await pool.query(
      'INSERT INTO medications (id, name, dci, form, dosage, category, requires_prescription, description) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
      [id, name, dci || null, form || null, dosage || null, category || null, requires_prescription ? 1 : 0, description || null]
    );
    const { rows } = await pool.query('SELECT * FROM medications WHERE id=$1', [id]);
    res.status(201).json({ success: true, data: medToDto(rows[0]) });
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
