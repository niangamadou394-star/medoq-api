const { v4: uuidv4 } = require('uuid');
const pool = require('../database/db');

// ─── Haversine distance in km ─────────────────────────────────────────────────
function haversine(lat1, lng1, lat2, lng2) {
  const R    = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a    = Math.sin(dLat / 2) ** 2 +
               Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) *
               Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ─── GET /pharmacies/nearby?lat=&lng=&radius=&medicationId= ──────────────────
async function nearby(req, res, next) {
  try {
    const { lat, lng, radius = 10, medicationId } = req.query;
    if (!lat || !lng) return res.status(400).json({ success: false, message: 'lat et lng requis' });

    let sql, args;
    if (medicationId) {
      sql  = `SELECT p.* FROM pharmacies p
              JOIN pharmacy_stock ps ON ps.pharmacy_id = p.id
              WHERE p.is_active=1 AND ps.medication_id=$1 AND ps.quantity > 0`;
      args = [medicationId];
    } else {
      sql  = 'SELECT * FROM pharmacies WHERE is_active=1';
      args = [];
    }

    const { rows: pharmacies } = await pool.query(sql, args);

    const userLat = parseFloat(lat);
    const userLng = parseFloat(lng);
    const maxKm   = parseFloat(radius);

    const results = pharmacies
      .map(p => ({ ...p, distanceKm: haversine(userLat, userLng, p.latitude, p.longitude) }))
      .filter(p => p.distanceKm <= maxKm)
      .sort((a, b) => a.distanceKm - b.distanceKm);

    res.json({ success: true, data: results.map(pharmaToDto) });
  } catch (err) { next(err); }
}

// ─── GET /pharmacies ──────────────────────────────────────────────────────────
async function list(req, res, next) {
  try {
    const { q = '', page = 1, limit = 20, lat, lng } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    let sql  = 'SELECT * FROM pharmacies WHERE is_active=1';
    const args = [];
    let idx  = 1;

    if (q) {
      sql += ` AND (LOWER(name) LIKE $${idx} OR LOWER(address) LIKE $${idx + 1})`;
      args.push(`%${q.toLowerCase()}%`, `%${q.toLowerCase()}%`);
      idx += 2;
    }

    const { rows: countRows } = await pool.query(sql.replace('SELECT *', 'SELECT COUNT(*) as cnt'), args);
    const total = parseInt(countRows[0].cnt);

    sql += ` ORDER BY rating DESC LIMIT $${idx} OFFSET $${idx + 1}`;
    args.push(parseInt(limit), offset);

    let { rows: pharmacies } = await pool.query(sql, args);

    if (lat && lng) {
      const uLat = parseFloat(lat), uLng = parseFloat(lng);
      pharmacies = pharmacies
        .map(p => ({ ...p, distanceKm: haversine(uLat, uLng, p.latitude, p.longitude) }))
        .sort((a, b) => a.distanceKm - b.distanceKm);
    }

    res.json({
      success: true,
      data: {
        pharmacies: pharmacies.map(pharmaToDto),
        total,
        page:       parseInt(page),
        limit:      parseInt(limit),
        totalPages: Math.ceil(total / parseInt(limit)),
      }
    });
  } catch (err) { next(err); }
}

// ─── GET /pharmacies/:id ──────────────────────────────────────────────────────
async function getById(req, res, next) {
  try {
    const { rows } = await pool.query('SELECT * FROM pharmacies WHERE id=$1 AND is_active=1', [req.params.id]);
    if (!rows[0]) return res.status(404).json({ success: false, message: 'Pharmacie introuvable' });
    res.json({ success: true, data: pharmaToDto(rows[0]) });
  } catch (err) { next(err); }
}

// ─── GET /pharmacies/:id/stock ────────────────────────────────────────────────
async function getStock(req, res, next) {
  try {
    const { q = '' } = req.query;
    let sql  = `
      SELECT ps.*, m.name as med_name, m.dci, m.form, m.dosage, m.category, m.requires_prescription
      FROM pharmacy_stock ps
      JOIN medications m ON m.id = ps.medication_id
      WHERE ps.pharmacy_id = $1
    `;
    const args = [req.params.id];

    if (q) {
      sql += ' AND (LOWER(m.name) LIKE $2 OR LOWER(m.dci) LIKE $3)';
      args.push(`%${q.toLowerCase()}%`, `%${q.toLowerCase()}%`);
    }
    sql += ' ORDER BY m.name ASC';

    const { rows } = await pool.query(sql, args);
    res.json({ success: true, data: rows.map(stockToDto) });
  } catch (err) { next(err); }
}

// ─── PUT /pharmacies/:id/stock/:medicationId ──────────────────────────────────
async function updateStock(req, res, next) {
  try {
    const { quantity, price, threshold } = req.body;
    const { id: pharmacyId, medicationId } = req.params;

    if (req.user.role === 'PHARMACY_STAFF') {
      const { rows } = await pool.query(
        'SELECT id FROM pharmacy_users WHERE pharmacy_id=$1 AND user_id=$2 AND is_active=1',
        [pharmacyId, req.user.id]
      );
      if (!rows[0]) return res.status(403).json({ success: false, message: 'Accès refusé à cette pharmacie' });
    }

    const { rows: existing } = await pool.query(
      'SELECT id FROM pharmacy_stock WHERE pharmacy_id=$1 AND medication_id=$2',
      [pharmacyId, medicationId]
    );

    const now = new Date().toISOString();
    if (!existing[0]) {
      await pool.query(
        'INSERT INTO pharmacy_stock (id, pharmacy_id, medication_id, quantity, price, threshold) VALUES ($1,$2,$3,$4,$5,$6)',
        [uuidv4(), pharmacyId, medicationId, quantity ?? 0, price, threshold ?? 5]
      );
    } else {
      const sets = [], vals = [];
      let idx = 1;
      if (quantity  !== undefined) { sets.push(`quantity=$${idx++}`);  vals.push(quantity); }
      if (price     !== undefined) { sets.push(`price=$${idx++}`);     vals.push(price); }
      if (threshold !== undefined) { sets.push(`threshold=$${idx++}`); vals.push(threshold); }
      if (sets.length) {
        sets.push(`updated_at=$${idx++}`);
        vals.push(now, pharmacyId, medicationId);
        await pool.query(
          `UPDATE pharmacy_stock SET ${sets.join(',')} WHERE pharmacy_id=$${idx} AND medication_id=$${idx + 1}`,
          vals
        );
      }
    }

    const { rows } = await pool.query(`
      SELECT ps.*, m.name as med_name, m.dci, m.form, m.dosage, m.category, m.requires_prescription
      FROM pharmacy_stock ps JOIN medications m ON m.id=ps.medication_id
      WHERE ps.pharmacy_id=$1 AND ps.medication_id=$2
    `, [pharmacyId, medicationId]);

    res.json({ success: true, data: stockToDto(rows[0]) });
  } catch (err) { next(err); }
}

// ─── GET /pharmacies/me ───────────────────────────────────────────────────────
async function myPharmacy(req, res, next) {
  try {
    const { rows: linkRows } = await pool.query(
      'SELECT pharmacy_id FROM pharmacy_users WHERE user_id=$1 AND is_active=1',
      [req.user.id]
    );
    if (!linkRows[0]) return res.status(404).json({ success: false, message: 'Aucune pharmacie liée' });

    const { rows } = await pool.query('SELECT * FROM pharmacies WHERE id=$1', [linkRows[0].pharmacy_id]);
    res.json({ success: true, data: pharmaToDto(rows[0]) });
  } catch (err) { next(err); }
}

// ─── DTOs ─────────────────────────────────────────────────────────────────────
function pharmaToDto(p) {
  return {
    id:            p.id,
    name:          p.name,
    address:       p.address,
    latitude:      p.latitude,
    longitude:     p.longitude,
    phone:         p.phone,
    openingHours:  p.opening_hours,
    isActive:      !!p.is_active,
    isVerified:    !!p.is_verified,
    description:   p.description,
    licenseNumber: p.license_number,
    rating:        p.rating,
    reviewCount:   p.review_count,
    distanceKm:    p.distanceKm !== undefined ? Math.round(p.distanceKm * 10) / 10 : null,
    createdAt:     p.created_at,
  };
}

function stockToDto(s) {
  return {
    id:                   s.id,
    pharmacyId:           s.pharmacy_id,
    medicationId:         s.medication_id,
    medicationName:       s.med_name,
    dci:                  s.dci,
    form:                 s.form,
    dosage:               s.dosage,
    category:             s.category,
    requiresPrescription: !!s.requires_prescription,
    quantity:             s.quantity,
    price:                s.price,
    threshold:            s.threshold,
    isLow:                s.quantity <= s.threshold,
    updatedAt:            s.updated_at,
  };
}

module.exports = { nearby, list, getById, getStock, updateStock, myPharmacy };
