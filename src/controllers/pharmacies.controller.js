const db = require('../database/db');

// ─── Haversine distance in km ────────────────────────────────────────────────
function haversine(lat1, lng1, lat2, lng2) {
  const R  = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a  = Math.sin(dLat / 2) ** 2 +
              Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) *
              Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ─── GET /pharmacies/nearby?lat=&lng=&radius=&medicationId= ───────────────────
function nearby(req, res, next) {
  try {
    const { lat, lng, radius = 10, medicationId } = req.query;
    if (!lat || !lng) return res.status(400).json({ success: false, message: 'lat et lng requis' });

    let sql = 'SELECT * FROM pharmacies WHERE is_active=1';
    const args = [];

    if (medicationId) {
      sql = `SELECT p.* FROM pharmacies p
             JOIN pharmacy_stock ps ON ps.pharmacy_id = p.id
             WHERE p.is_active=1 AND ps.medication_id=? AND ps.quantity > 0`;
      args.push(medicationId);
    }

    const pharmacies = db.prepare(sql).all(...args);

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
function list(req, res, next) {
  try {
    const { q = '', page = 1, limit = 20, lat, lng } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    let sql = 'SELECT * FROM pharmacies WHERE is_active=1';
    const args = [];

    if (q) {
      sql += ' AND (LOWER(name) LIKE ? OR LOWER(address) LIKE ?)';
      args.push(`%${q.toLowerCase()}%`, `%${q.toLowerCase()}%`);
    }

    const total = db.prepare(sql.replace('SELECT *', 'SELECT COUNT(*) as cnt')).get(...args).cnt;
    sql += ' ORDER BY rating DESC LIMIT ? OFFSET ?';
    args.push(parseInt(limit), offset);

    let pharmacies = db.prepare(sql).all(...args);

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
        total, page: parseInt(page), limit: parseInt(limit),
        totalPages: Math.ceil(total / parseInt(limit))
      }
    });
  } catch (err) { next(err); }
}

// ─── GET /pharmacies/:id ──────────────────────────────────────────────────────
function getById(req, res, next) {
  try {
    const p = db.prepare('SELECT * FROM pharmacies WHERE id=? AND is_active=1').get(req.params.id);
    if (!p) return res.status(404).json({ success: false, message: 'Pharmacie introuvable' });
    res.json({ success: true, data: pharmaToDto(p) });
  } catch (err) { next(err); }
}

// ─── GET /pharmacies/:id/stock ────────────────────────────────────────────────
function getStock(req, res, next) {
  try {
    const { q = '' } = req.query;
    let sql = `
      SELECT ps.*, m.name as med_name, m.dci, m.form, m.dosage, m.category, m.requires_prescription
      FROM pharmacy_stock ps
      JOIN medications m ON m.id = ps.medication_id
      WHERE ps.pharmacy_id = ?
    `;
    const args = [req.params.id];

    if (q) {
      sql += ' AND (LOWER(m.name) LIKE ? OR LOWER(m.dci) LIKE ?)';
      args.push(`%${q.toLowerCase()}%`, `%${q.toLowerCase()}%`);
    }

    sql += ' ORDER BY m.name ASC';
    const stock = db.prepare(sql).all(...args);

    res.json({ success: true, data: stock.map(stockToDto) });
  } catch (err) { next(err); }
}

// ─── PUT /pharmacies/:id/stock/:medicationId ──────────────────────────────────
function updateStock(req, res, next) {
  try {
    const { quantity, price, threshold } = req.body;
    const { id: pharmacyId, medicationId } = req.params;

    // Check staff is linked to this pharmacy
    if (req.user.role === 'PHARMACY_STAFF') {
      const link = db.prepare('SELECT id FROM pharmacy_users WHERE pharmacy_id=? AND user_id=? AND is_active=1').get(pharmacyId, req.user.id);
      if (!link) return res.status(403).json({ success: false, message: 'Accès refusé à cette pharmacie' });
    }

    const existing = db.prepare('SELECT id FROM pharmacy_stock WHERE pharmacy_id=? AND medication_id=?').get(pharmacyId, medicationId);
    if (!existing) {
      const { v4: uuidv4 } = require('uuid');
      db.prepare('INSERT INTO pharmacy_stock (id, pharmacy_id, medication_id, quantity, price, threshold) VALUES (?,?,?,?,?,?)')
        .run(uuidv4(), pharmacyId, medicationId, quantity ?? 0, price, threshold ?? 5);
    } else {
      const sets = [];
      const vals = [];
      if (quantity !== undefined) { sets.push('quantity=?'); vals.push(quantity); }
      if (price    !== undefined) { sets.push('price=?');    vals.push(price); }
      if (threshold!== undefined) { sets.push('threshold=?');vals.push(threshold); }
      if (sets.length) {
        sets.push("updated_at=datetime('now')");
        vals.push(pharmacyId, medicationId);
        db.prepare(`UPDATE pharmacy_stock SET ${sets.join(',')} WHERE pharmacy_id=? AND medication_id=?`).run(...vals);
      }
    }

    const updated = db.prepare(`
      SELECT ps.*, m.name as med_name, m.dci, m.form, m.dosage, m.category, m.requires_prescription
      FROM pharmacy_stock ps JOIN medications m ON m.id=ps.medication_id
      WHERE ps.pharmacy_id=? AND ps.medication_id=?
    `).get(pharmacyId, medicationId);

    res.json({ success: true, data: stockToDto(updated) });
  } catch (err) { next(err); }
}

// ─── GET /pharmacies/me — pharmacy staff's own pharmacy ──────────────────────
function myPharmacy(req, res, next) {
  try {
    const link = db.prepare('SELECT pharmacy_id FROM pharmacy_users WHERE user_id=? AND is_active=1').get(req.user.id);
    if (!link) return res.status(404).json({ success: false, message: 'Aucune pharmacie liée' });
    const p = db.prepare('SELECT * FROM pharmacies WHERE id=?').get(link.pharmacy_id);
    res.json({ success: true, data: pharmaToDto(p) });
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
    id:                  s.id,
    pharmacyId:          s.pharmacy_id,
    medicationId:        s.medication_id,
    medicationName:      s.med_name,
    dci:                 s.dci,
    form:                s.form,
    dosage:              s.dosage,
    category:            s.category,
    requiresPrescription:!!s.requires_prescription,
    quantity:            s.quantity,
    price:               s.price,
    threshold:           s.threshold,
    isLow:               s.quantity <= s.threshold,
    updatedAt:           s.updated_at,
  };
}

module.exports = { nearby, list, getById, getStock, updateStock, myPharmacy };
