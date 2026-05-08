const { v4: uuidv4 } = require('uuid');
const pool = require('../database/db');
const { sendReservationConfirmed, sendReservationReady } = require('../services/sms');

const EXPIRY_HOURS    = parseInt(process.env.RESERVATION_EXPIRY_HOURS) || 2;
const DELIVERY_FEE    = parseFloat(process.env.DELIVERY_FEE) || 1500;

// ─── Ref number generator ─────────────────────────────────────────────────────
async function makeRef() {
  const { rows } = await pool.query('SELECT COUNT(*) as cnt FROM reservations');
  const count = parseInt(rows[0].cnt);
  const year  = new Date().getFullYear();
  return `MRX-${year}-${String(count + 1).padStart(6, '0')}`;
}

// ─── POST /reservations ───────────────────────────────────────────────────────
async function create(req, res, next) {
  const client = await pool.connect();
  try {
    const { pharmacyId, medicationId, quantity, notes, deliveryType, deliveryAddress } = req.body;
    const patientId  = req.user.id;
    const isDelivery = deliveryType === 'DELIVERY';

    if (isDelivery && !deliveryAddress?.trim()) {
      return res.status(400).json({ success: false, message: 'Adresse de livraison requise' });
    }

    // Validate stock
    const { rows: stockRows } = await client.query(
      'SELECT * FROM pharmacy_stock WHERE pharmacy_id=$1 AND medication_id=$2',
      [pharmacyId, medicationId]
    );
    const stock = stockRows[0];
    if (!stock) return res.status(404).json({ success: false, message: 'Médicament introuvable dans cette pharmacie' });
    if (stock.quantity < quantity) return res.status(400).json({ success: false, message: `Stock insuffisant (disponible: ${stock.quantity})` });

    const { rows: pharmaRows } = await client.query('SELECT id, name FROM pharmacies WHERE id=$1 AND is_active=1', [pharmacyId]);
    const { rows: medRows }    = await client.query('SELECT id, name, requires_prescription FROM medications WHERE id=$1 AND is_active=1', [medicationId]);
    if (!pharmaRows[0]) return res.status(404).json({ success: false, message: 'Pharmacie introuvable' });
    if (!medRows[0])    return res.status(404).json({ success: false, message: 'Médicament introuvable' });

    const pharmacy   = pharmaRows[0];
    const medication = medRows[0];

    const deliveryFeeAmt = isDelivery ? DELIVERY_FEE : 0;
    const totalAmount    = stock.price * quantity + deliveryFeeAmt;
    const expiresAt      = new Date(Date.now() + EXPIRY_HOURS * 3600 * 1000).toISOString();
    const now            = new Date().toISOString();
    const id             = uuidv4();
    const refNumber      = await makeRef();

    await client.query('BEGIN');

    await client.query(
      'UPDATE pharmacy_stock SET quantity=quantity-$1, updated_at=$2 WHERE pharmacy_id=$3 AND medication_id=$4',
      [quantity, now, pharmacyId, medicationId]
    );

    await client.query(`
      INSERT INTO reservations
        (id, ref_number, patient_id, pharmacy_id, medication_id, quantity, status, expires_at,
         total_amount, notes, delivery_type, delivery_address, delivery_fee)
      VALUES ($1,$2,$3,$4,$5,$6,'CONFIRMED',$7,$8,$9,$10,$11,$12)
    `, [
      id, refNumber, patientId, pharmacyId, medicationId, quantity, expiresAt, totalAmount,
      notes || null,
      isDelivery ? 'DELIVERY' : 'PICKUP',
      isDelivery ? deliveryAddress.trim() : null,
      deliveryFeeAmt,
    ]);

    await client.query('COMMIT');

    // Fetch patient phone for SMS
    const { rows: patRows } = await pool.query('SELECT phone FROM users WHERE id=$1', [patientId]);
    const patientPhone = patRows[0]?.phone;

    // Send confirmation SMS (non-blocking)
    if (patientPhone) {
      sendReservationConfirmed(patientPhone, refNumber, pharmacy.name, medication.name).catch(() => {});
    }

    const resa = await getResaFull(id);
    res.status(201).json({ success: true, data: resaToDto(resa) });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    next(err);
  } finally {
    client.release();
  }
}

// ─── GET /reservations — patient sees their own ───────────────────────────────
async function myReservations(req, res, next) {
  try {
    const { status, page = 1, limit = 20 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    let sql  = `SELECT r.*, p.name as pharmacy_name, p.address as pharmacy_address, p.phone as pharmacy_phone,
                m.name as med_name, m.form as med_form, m.dosage as med_dosage
                FROM reservations r
                JOIN pharmacies p ON p.id=r.pharmacy_id
                JOIN medications m ON m.id=r.medication_id
                WHERE r.patient_id=$1`;
    const args = [req.user.id];
    let idx  = 2;

    if (status) { sql += ` AND r.status=$${idx}`; args.push(status.toUpperCase()); idx++; }

    const { rows: countRows } = await pool.query(
      `SELECT COUNT(*) as cnt FROM reservations r WHERE r.patient_id=$1${status ? ` AND r.status=$2` : ''}`,
      status ? [req.user.id, status.toUpperCase()] : [req.user.id]
    );
    const total = parseInt(countRows[0].cnt);

    sql += ` ORDER BY r.created_at DESC LIMIT $${idx} OFFSET $${idx + 1}`;
    args.push(parseInt(limit), offset);

    const { rows: resas } = await pool.query(sql, args);
    res.json({
      success: true,
      data: {
        reservations: resas.map(resaToDto),
        total,
        page:       parseInt(page),
        limit:      parseInt(limit),
        totalPages: Math.ceil(total / parseInt(limit)),
      }
    });
  } catch (err) { next(err); }
}

// ─── GET /reservations/pharmacy ───────────────────────────────────────────────
async function pharmacyReservations(req, res, next) {
  try {
    const { rows: linkRows } = await pool.query(
      'SELECT pharmacy_id FROM pharmacy_users WHERE user_id=$1 AND is_active=1',
      [req.user.id]
    );
    if (!linkRows[0]) return res.status(403).json({ success: false, message: 'Non lié à une pharmacie' });

    const { status, page = 1, limit = 20 } = req.query;
    const pharmacyId = linkRows[0].pharmacy_id;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    let sql  = `SELECT r.*, p.name as pharmacy_name, p.address as pharmacy_address, p.phone as pharmacy_phone,
                m.name as med_name, m.form as med_form, m.dosage as med_dosage,
                u.name as patient_name, u.phone as patient_phone
                FROM reservations r
                JOIN pharmacies p ON p.id=r.pharmacy_id
                JOIN medications m ON m.id=r.medication_id
                JOIN users u ON u.id=r.patient_id
                WHERE r.pharmacy_id=$1`;
    const args = [pharmacyId];
    let idx  = 2;

    if (status) { sql += ` AND r.status=$${idx}`; args.push(status.toUpperCase()); idx++; }
    sql += ` ORDER BY r.created_at DESC LIMIT $${idx} OFFSET $${idx + 1}`;
    args.push(parseInt(limit), offset);

    const { rows: resas } = await pool.query(sql, args);
    res.json({
      success: true,
      data: resas.map(r => ({ ...resaToDto(r), patientName: r.patient_name, patientPhone: r.patient_phone }))
    });
  } catch (err) { next(err); }
}

// ─── GET /reservations/:id ────────────────────────────────────────────────────
async function getById(req, res, next) {
  try {
    const resa = await getResaFull(req.params.id);
    if (!resa) return res.status(404).json({ success: false, message: 'Réservation introuvable' });

    if (req.user.role === 'PATIENT' && resa.patient_id !== req.user.id) {
      return res.status(403).json({ success: false, message: 'Accès refusé' });
    }
    if (req.user.role === 'PHARMACY_STAFF') {
      const { rows } = await pool.query(
        'SELECT id FROM pharmacy_users WHERE pharmacy_id=$1 AND user_id=$2 AND is_active=1',
        [resa.pharmacy_id, req.user.id]
      );
      if (!rows[0]) return res.status(403).json({ success: false, message: 'Accès refusé' });
    }

    res.json({ success: true, data: resaToDto(resa) });
  } catch (err) { next(err); }
}

// ─── POST /reservations/:id/cancel ───────────────────────────────────────────
async function cancel(req, res, next) {
  const client = await pool.connect();
  try {
    const { rows } = await client.query('SELECT * FROM reservations WHERE id=$1', [req.params.id]);
    const resa = rows[0];
    if (!resa) return res.status(404).json({ success: false, message: 'Réservation introuvable' });
    if (req.user.role === 'PATIENT' && resa.patient_id !== req.user.id) {
      return res.status(403).json({ success: false, message: 'Accès refusé' });
    }
    if (!['CONFIRMED', 'PENDING'].includes(resa.status)) {
      return res.status(400).json({ success: false, message: `Impossible d'annuler: statut ${resa.status}` });
    }

    const now = new Date().toISOString();
    await client.query('BEGIN');
    await client.query('UPDATE reservations SET status=$1, updated_at=$2 WHERE id=$3', ['CANCELLED', now, resa.id]);
    await client.query(
      'UPDATE pharmacy_stock SET quantity=quantity+$1, updated_at=$2 WHERE pharmacy_id=$3 AND medication_id=$4',
      [resa.quantity, now, resa.pharmacy_id, resa.medication_id]
    );
    await client.query('COMMIT');

    res.json({ success: true, message: 'Réservation annulée', data: { id: resa.id, status: 'CANCELLED' } });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    next(err);
  } finally {
    client.release();
  }
}

// ─── POST /reservations/:id/ready ────────────────────────────────────────────
async function markReady(req, res, next) {
  try {
    const { rows } = await pool.query('SELECT * FROM reservations WHERE id=$1', [req.params.id]);
    const resa = rows[0];
    if (!resa) return res.status(404).json({ success: false, message: 'Réservation introuvable' });

    if (req.user.role === 'PHARMACY_STAFF') {
      const { rows: lRows } = await pool.query(
        'SELECT id FROM pharmacy_users WHERE pharmacy_id=$1 AND user_id=$2 AND is_active=1',
        [resa.pharmacy_id, req.user.id]
      );
      if (!lRows[0]) return res.status(403).json({ success: false, message: 'Accès refusé' });
    }

    if (resa.status !== 'CONFIRMED') {
      return res.status(400).json({ success: false, message: `Statut actuel: ${resa.status}` });
    }

    const now = new Date().toISOString();
    await pool.query('UPDATE reservations SET status=$1, updated_at=$2 WHERE id=$3', ['READY', now, resa.id]);

    // Notify patient by SMS
    const { rows: patRows } = await pool.query(
      `SELECT u.phone, p.name as pharmacy_name FROM users u
       JOIN pharmacies p ON p.id=$1
       WHERE u.id=$2`, [resa.pharmacy_id, resa.patient_id]
    );
    if (patRows[0]) {
      sendReservationReady(patRows[0].phone, resa.ref_number, patRows[0].pharmacy_name).catch(() => {});
    }

    res.json({ success: true, message: 'Réservation marquée prête', data: { id: resa.id, status: 'READY' } });
  } catch (err) { next(err); }
}

// ─── POST /reservations/:id/complete ─────────────────────────────────────────
async function complete(req, res, next) {
  try {
    const { rows } = await pool.query('SELECT * FROM reservations WHERE id=$1', [req.params.id]);
    const resa = rows[0];
    if (!resa) return res.status(404).json({ success: false, message: 'Réservation introuvable' });

    if (req.user.role === 'PHARMACY_STAFF') {
      const { rows: lRows } = await pool.query(
        'SELECT id FROM pharmacy_users WHERE pharmacy_id=$1 AND user_id=$2 AND is_active=1',
        [resa.pharmacy_id, req.user.id]
      );
      if (!lRows[0]) return res.status(403).json({ success: false, message: 'Accès refusé' });
    }

    if (!['CONFIRMED', 'READY'].includes(resa.status)) {
      return res.status(400).json({ success: false, message: `Impossible de terminer: statut ${resa.status}` });
    }

    const now = new Date().toISOString();
    await pool.query('UPDATE reservations SET status=$1, updated_at=$2 WHERE id=$3', ['COMPLETED', now, resa.id]);
    res.json({ success: true, message: 'Réservation complétée', data: { id: resa.id, status: 'COMPLETED' } });
  } catch (err) { next(err); }
}

// ─── Admin: GET /reservations/all ────────────────────────────────────────────
async function all(req, res, next) {
  try {
    const { status, pharmacyId, page = 1, limit = 50 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    let sql  = `SELECT r.*, p.name as pharmacy_name, m.name as med_name, u.name as patient_name, u.phone as patient_phone
                FROM reservations r
                JOIN pharmacies p ON p.id=r.pharmacy_id
                JOIN medications m ON m.id=r.medication_id
                JOIN users u ON u.id=r.patient_id WHERE 1=1`;
    const args = [];
    let idx  = 1;

    if (status)     { sql += ` AND r.status=$${idx}`; args.push(status.toUpperCase()); idx++; }
    if (pharmacyId) { sql += ` AND r.pharmacy_id=$${idx}`; args.push(pharmacyId); idx++; }

    sql += ` ORDER BY r.created_at DESC LIMIT $${idx} OFFSET $${idx + 1}`;
    args.push(parseInt(limit), offset);

    const { rows: resas } = await pool.query(sql, args);
    res.json({
      success: true,
      data: resas.map(r => ({ ...resaToDto(r), patientName: r.patient_name, patientPhone: r.patient_phone }))
    });
  } catch (err) { next(err); }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
async function getResaFull(id) {
  const { rows } = await pool.query(`
    SELECT r.*, p.name as pharmacy_name, p.address as pharmacy_address, p.phone as pharmacy_phone,
           m.name as med_name, m.form as med_form, m.dosage as med_dosage
    FROM reservations r
    JOIN pharmacies p ON p.id=r.pharmacy_id
    JOIN medications m ON m.id=r.medication_id
    WHERE r.id=$1
  `, [id]);
  return rows[0] || null;
}

function resaToDto(r) {
  return {
    id:               r.id,
    refNumber:        r.ref_number,
    patientId:        r.patient_id,
    pharmacyId:       r.pharmacy_id,
    pharmacyName:     r.pharmacy_name,
    pharmacyAddress:  r.pharmacy_address,
    pharmacyPhone:    r.pharmacy_phone,
    medicationId:     r.medication_id,
    medicationName:   r.med_name,
    medicationForm:   r.med_form,
    medicationDosage: r.med_dosage,
    quantity:         r.quantity,
    status:           r.status,
    expiresAt:        r.expires_at,
    totalAmount:      r.total_amount,
    notes:            r.notes,
    deliveryType:     r.delivery_type    || 'PICKUP',
    deliveryAddress:  r.delivery_address || null,
    deliveryFee:      r.delivery_fee     || 0,
    createdAt:        r.created_at,
    updatedAt:        r.updated_at,
  };
}

module.exports = { create, myReservations, pharmacyReservations, getById, cancel, complete, markReady, all };
