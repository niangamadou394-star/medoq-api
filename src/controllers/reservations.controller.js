const { v4: uuidv4 } = require('uuid');
const db = require('../database/db');

const EXPIRY_HOURS    = parseInt(process.env.RESERVATION_EXPIRY_HOURS) || 2;
const COMMISSION_RATE = parseFloat(process.env.COMMISSION_RATE) || 1.5;
const DELIVERY_FEE    = parseFloat(process.env.DELIVERY_FEE) || 1500;

// ─── Ref number generator (e.g. MRx-2026-000042) ─────────────────────────────
function makeRef() {
  const count = db.prepare("SELECT COUNT(*) as cnt FROM reservations").get().cnt;
  const year  = new Date().getFullYear();
  return `MRX-${year}-${String(count + 1).padStart(6, '0')}`;
}

// ─── POST /reservations ───────────────────────────────────────────────────────
function create(req, res, next) {
  try {
    const { pharmacyId, medicationId, quantity, notes, deliveryType, deliveryAddress } = req.body;
    const patientId  = req.user.id;
    const isDelivery = deliveryType === 'DELIVERY';

    if (isDelivery && !deliveryAddress?.trim())
      return res.status(400).json({ success: false, message: 'Adresse de livraison requise' });

    // Validate stock
    const stock = db.prepare('SELECT * FROM pharmacy_stock WHERE pharmacy_id=? AND medication_id=?').get(pharmacyId, medicationId);
    if (!stock)                      return res.status(404).json({ success: false, message: 'Médicament introuvable dans cette pharmacie' });
    if (stock.quantity < quantity)   return res.status(400).json({ success: false, message: `Stock insuffisant (disponible: ${stock.quantity})` });

    // Check pharmacy/medication exist
    const pharmacy   = db.prepare('SELECT id, name FROM pharmacies WHERE id=? AND is_active=1').get(pharmacyId);
    const medication = db.prepare('SELECT id, name, requires_prescription FROM medications WHERE id=? AND is_active=1').get(medicationId);
    if (!pharmacy)   return res.status(404).json({ success: false, message: 'Pharmacie introuvable' });
    if (!medication) return res.status(404).json({ success: false, message: 'Médicament introuvable' });

    const deliveryFeeAmt = isDelivery ? DELIVERY_FEE : 0;
    const totalAmount    = stock.price * quantity + deliveryFeeAmt;
    const expiresAt      = new Date(Date.now() + EXPIRY_HOURS * 3600 * 1000).toISOString();
    const id             = uuidv4();
    const refNumber      = makeRef();

    // Decrement stock & insert reservation in a transaction
    const doInsert = db.transaction(() => {
      db.prepare('UPDATE pharmacy_stock SET quantity=quantity-?, updated_at=datetime(\'now\') WHERE pharmacy_id=? AND medication_id=?')
        .run(quantity, pharmacyId, medicationId);
      db.prepare(`INSERT INTO reservations
                  (id, ref_number, patient_id, pharmacy_id, medication_id, quantity, status, expires_at, total_amount, notes, delivery_type, delivery_address, delivery_fee)
                  VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`)
        .run(id, refNumber, patientId, pharmacyId, medicationId, quantity, 'CONFIRMED', expiresAt, totalAmount,
             notes || null, isDelivery ? 'DELIVERY' : 'PICKUP', isDelivery ? deliveryAddress.trim() : null, deliveryFeeAmt);
    });
    doInsert();

    const resa = getResaFull(id);
    res.status(201).json({ success: true, data: resaToDto(resa) });
  } catch (err) { next(err); }
}

// ─── GET /reservations — patient sees their own ───────────────────────────────
function myReservations(req, res, next) {
  try {
    const { status, page = 1, limit = 20 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    let sql = `SELECT r.*, p.name as pharmacy_name, p.address as pharmacy_address, p.phone as pharmacy_phone,
               m.name as med_name, m.form as med_form, m.dosage as med_dosage
               FROM reservations r
               JOIN pharmacies p ON p.id=r.pharmacy_id
               JOIN medications m ON m.id=r.medication_id
               WHERE r.patient_id=?`;
    const args = [req.user.id];

    if (status) { sql += ' AND r.status=?'; args.push(status.toUpperCase()); }
    const total = db.prepare(sql.replace('SELECT r.*,', 'SELECT COUNT(*) as cnt,').replace(/JOIN.*WHERE/, 'WHERE')).get(...args)?.cnt ?? 0;

    sql += ' ORDER BY r.created_at DESC LIMIT ? OFFSET ?';
    args.push(parseInt(limit), offset);

    const resas = db.prepare(sql).all(...args);
    res.json({
      success: true,
      data: { reservations: resas.map(resaToDto), total, page: parseInt(page), limit: parseInt(limit), totalPages: Math.ceil(total / parseInt(limit)) }
    });
  } catch (err) { next(err); }
}

// ─── GET /reservations/pharmacy — pharmacy staff sees their pharmacy's resas ──
function pharmacyReservations(req, res, next) {
  try {
    const link = db.prepare('SELECT pharmacy_id FROM pharmacy_users WHERE user_id=? AND is_active=1').get(req.user.id);
    if (!link) return res.status(403).json({ success: false, message: 'Non lié à une pharmacie' });

    const { status, page = 1, limit = 20 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    let sql = `SELECT r.*, p.name as pharmacy_name, p.address as pharmacy_address, p.phone as pharmacy_phone,
               m.name as med_name, m.form as med_form, m.dosage as med_dosage,
               u.name as patient_name, u.phone as patient_phone
               FROM reservations r
               JOIN pharmacies p ON p.id=r.pharmacy_id
               JOIN medications m ON m.id=r.medication_id
               JOIN users u ON u.id=r.patient_id
               WHERE r.pharmacy_id=?`;
    const args = [link.pharmacy_id];

    if (status) { sql += ' AND r.status=?'; args.push(status.toUpperCase()); }
    sql += ' ORDER BY r.created_at DESC LIMIT ? OFFSET ?';
    args.push(parseInt(limit), offset);

    const resas = db.prepare(sql).all(...args);
    res.json({ success: true, data: resas.map(r => ({ ...resaToDto(r), patientName: r.patient_name, patientPhone: r.patient_phone })) });
  } catch (err) { next(err); }
}

// ─── GET /reservations/:id ────────────────────────────────────────────────────
function getById(req, res, next) {
  try {
    const resa = getResaFull(req.params.id);
    if (!resa) return res.status(404).json({ success: false, message: 'Réservation introuvable' });

    // Patient can see own; pharmacy staff can see their pharmacy's; admin can see all
    if (req.user.role === 'PATIENT' && resa.patient_id !== req.user.id) {
      return res.status(403).json({ success: false, message: 'Accès refusé' });
    }
    if (req.user.role === 'PHARMACY_STAFF') {
      const link = db.prepare('SELECT id FROM pharmacy_users WHERE pharmacy_id=? AND user_id=? AND is_active=1').get(resa.pharmacy_id, req.user.id);
      if (!link) return res.status(403).json({ success: false, message: 'Accès refusé' });
    }

    res.json({ success: true, data: resaToDto(resa) });
  } catch (err) { next(err); }
}

// ─── POST /reservations/:id/cancel ───────────────────────────────────────────
function cancel(req, res, next) {
  try {
    const resa = db.prepare('SELECT * FROM reservations WHERE id=?').get(req.params.id);
    if (!resa) return res.status(404).json({ success: false, message: 'Réservation introuvable' });
    if (req.user.role === 'PATIENT' && resa.patient_id !== req.user.id)
      return res.status(403).json({ success: false, message: 'Accès refusé' });
    if (!['CONFIRMED', 'PENDING'].includes(resa.status))
      return res.status(400).json({ success: false, message: `Impossible d'annuler une réservation ${resa.status}` });

    const doCancel = db.transaction(() => {
      db.prepare('UPDATE reservations SET status=\'CANCELLED\', updated_at=datetime(\'now\') WHERE id=?').run(resa.id);
      // Restock
      db.prepare('UPDATE pharmacy_stock SET quantity=quantity+?, updated_at=datetime(\'now\') WHERE pharmacy_id=? AND medication_id=?')
        .run(resa.quantity, resa.pharmacy_id, resa.medication_id);
    });
    doCancel();

    res.json({ success: true, message: 'Réservation annulée', data: { id: resa.id, status: 'CANCELLED' } });
  } catch (err) { next(err); }
}

// ─── POST /reservations/:id/complete — pharmacy staff marks as picked up ──────
function complete(req, res, next) {
  try {
    const resa = db.prepare('SELECT * FROM reservations WHERE id=?').get(req.params.id);
    if (!resa) return res.status(404).json({ success: false, message: 'Réservation introuvable' });

    if (req.user.role === 'PHARMACY_STAFF') {
      const link = db.prepare('SELECT id FROM pharmacy_users WHERE pharmacy_id=? AND user_id=? AND is_active=1').get(resa.pharmacy_id, req.user.id);
      if (!link) return res.status(403).json({ success: false, message: 'Accès refusé' });
    }

    if (!['CONFIRMED', 'READY'].includes(resa.status))
      return res.status(400).json({ success: false, message: `Impossible de terminer une réservation ${resa.status}` });

    db.prepare('UPDATE reservations SET status=\'COMPLETED\', updated_at=datetime(\'now\') WHERE id=?').run(resa.id);
    res.json({ success: true, message: 'Réservation complétée', data: { id: resa.id, status: 'COMPLETED' } });
  } catch (err) { next(err); }
}

// ─── POST /reservations/:id/ready — pharmacy staff marks as ready ─────────────
function markReady(req, res, next) {
  try {
    const resa = db.prepare('SELECT * FROM reservations WHERE id=?').get(req.params.id);
    if (!resa) return res.status(404).json({ success: false, message: 'Réservation introuvable' });

    if (req.user.role === 'PHARMACY_STAFF') {
      const link = db.prepare('SELECT id FROM pharmacy_users WHERE pharmacy_id=? AND user_id=? AND is_active=1').get(resa.pharmacy_id, req.user.id);
      if (!link) return res.status(403).json({ success: false, message: 'Accès refusé' });
    }

    if (resa.status !== 'CONFIRMED')
      return res.status(400).json({ success: false, message: `Statut actuel: ${resa.status}` });

    db.prepare('UPDATE reservations SET status=\'READY\', updated_at=datetime(\'now\') WHERE id=?').run(resa.id);
    res.json({ success: true, message: 'Réservation marquée prête', data: { id: resa.id, status: 'READY' } });
  } catch (err) { next(err); }
}

// ─── Admin: GET /reservations/all ─────────────────────────────────────────────
function all(req, res, next) {
  try {
    const { status, pharmacyId, page = 1, limit = 50 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);
    let sql  = `SELECT r.*, p.name as pharmacy_name, m.name as med_name, u.name as patient_name, u.phone as patient_phone
                FROM reservations r
                JOIN pharmacies p ON p.id=r.pharmacy_id
                JOIN medications m ON m.id=r.medication_id
                JOIN users u ON u.id=r.patient_id WHERE 1=1`;
    const args = [];
    if (status)     { sql += ' AND r.status=?';      args.push(status.toUpperCase()); }
    if (pharmacyId) { sql += ' AND r.pharmacy_id=?'; args.push(pharmacyId); }
    sql += ' ORDER BY r.created_at DESC LIMIT ? OFFSET ?';
    args.push(parseInt(limit), offset);
    const resas = db.prepare(sql).all(...args);
    res.json({ success: true, data: resas.map(r => ({ ...resaToDto(r), patientName: r.patient_name, patientPhone: r.patient_phone })) });
  } catch (err) { next(err); }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function getResaFull(id) {
  return db.prepare(`
    SELECT r.*, p.name as pharmacy_name, p.address as pharmacy_address, p.phone as pharmacy_phone,
           m.name as med_name, m.form as med_form, m.dosage as med_dosage
    FROM reservations r
    JOIN pharmacies p ON p.id=r.pharmacy_id
    JOIN medications m ON m.id=r.medication_id
    WHERE r.id=?
  `).get(id);
}

function resaToDto(r) {
  return {
    id:              r.id,
    refNumber:       r.ref_number,
    patientId:       r.patient_id,
    pharmacyId:      r.pharmacy_id,
    pharmacyName:    r.pharmacy_name,
    pharmacyAddress: r.pharmacy_address,
    pharmacyPhone:   r.pharmacy_phone,
    medicationId:    r.medication_id,
    medicationName:  r.med_name,
    medicationForm:  r.med_form,
    medicationDosage:r.med_dosage,
    quantity:        r.quantity,
    status:          r.status,
    expiresAt:       r.expires_at,
    totalAmount:     r.total_amount,
    notes:           r.notes,
    deliveryType:    r.delivery_type    || 'PICKUP',
    deliveryAddress: r.delivery_address || null,
    deliveryFee:     r.delivery_fee     || 0,
    createdAt:       r.created_at,
    updatedAt:       r.updated_at,
  };
}

module.exports = { create, myReservations, pharmacyReservations, getById, cancel, complete, markReady, all };
