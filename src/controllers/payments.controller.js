const { v4: uuidv4 } = require('uuid');
const db = require('../database/db');

const COMMISSION_RATE = parseFloat(process.env.COMMISSION_RATE) || 1.5;

// ─── POST /payments/initiate ──────────────────────────────────────────────────
function initiate(req, res, next) {
  try {
    const { reservationId, method } = req.body; // method: WAVE | ORANGE_MONEY | CASH

    const resa = db.prepare('SELECT * FROM reservations WHERE id=?').get(reservationId);
    if (!resa) return res.status(404).json({ success: false, message: 'Réservation introuvable' });
    if (req.user.role === 'PATIENT' && resa.patient_id !== req.user.id)
      return res.status(403).json({ success: false, message: 'Accès refusé' });
    if (!['CONFIRMED', 'READY'].includes(resa.status))
      return res.status(400).json({ success: false, message: `Paiement impossible pour le statut: ${resa.status}` });

    // Check no existing pending payment
    const existing = db.prepare('SELECT * FROM payments WHERE reservation_id=?').get(reservationId);
    if (existing && existing.status === 'COMPLETED')
      return res.status(400).json({ success: false, message: 'Déjà payé' });

    const amount     = resa.total_amount;
    const commission = Math.round(amount * COMMISSION_RATE) / 100;
    const id         = uuidv4();

    // For CASH: instantly mark as completed
    if (method === 'CASH') {
      if (existing) {
        db.prepare('UPDATE payments SET status=\'COMPLETED\', completed_at=datetime(\'now\') WHERE id=?').run(existing.id);
      } else {
        db.prepare(`INSERT INTO payments (id, reservation_id, method, amount, commission, commission_rate, status, completed_at)
                    VALUES (?,?,?,?,?,?,\'COMPLETED\',datetime('now'))`)
          .run(id, reservationId, 'CASH', amount, commission, COMMISSION_RATE);
      }
      db.prepare('UPDATE reservations SET status=\'COMPLETED\', updated_at=datetime(\'now\') WHERE id=?').run(reservationId);
      return res.json({ success: true, message: 'Paiement cash enregistré', data: { method: 'CASH', status: 'COMPLETED', amount } });
    }

    // Mobile money: simulate checkout URL (real integration requires Wave/OM API keys)
    const fakeCheckoutUrl = `https://pay.medoq.sn/checkout/${id}?method=${method}&amount=${amount}`;
    const payRef = `${method}-${Date.now()}`;

    if (existing) {
      db.prepare('UPDATE payments SET method=?, wave_ref=?, orange_ref=?, checkout_url=?, status=\'PENDING\' WHERE id=?')
        .run(method, method === 'WAVE' ? payRef : null, method === 'ORANGE_MONEY' ? payRef : null, fakeCheckoutUrl, existing.id);
    } else {
      db.prepare(`INSERT INTO payments (id, reservation_id, method, amount, commission, commission_rate, status, wave_ref, orange_ref, checkout_url)
                  VALUES (?,?,?,?,?,?,\'PENDING\',?,?,?)`)
        .run(id, reservationId, method, amount, commission, COMMISSION_RATE,
             method === 'WAVE' ? payRef : null,
             method === 'ORANGE_MONEY' ? payRef : null,
             fakeCheckoutUrl);
    }

    res.json({
      success: true,
      message: 'Paiement initié',
      data: { paymentId: existing?.id || id, method, status: 'PENDING', amount, commission, checkoutUrl: fakeCheckoutUrl }
    });
  } catch (err) { next(err); }
}

// ─── GET /payments/reservation/:reservationId ─────────────────────────────────
function getByReservation(req, res, next) {
  try {
    const resa = db.prepare('SELECT * FROM reservations WHERE id=?').get(req.params.reservationId);
    if (!resa) return res.status(404).json({ success: false, message: 'Réservation introuvable' });
    if (req.user.role === 'PATIENT' && resa.patient_id !== req.user.id)
      return res.status(403).json({ success: false, message: 'Accès refusé' });

    const payment = db.prepare('SELECT * FROM payments WHERE reservation_id=?').get(req.params.reservationId);
    if (!payment) return res.status(404).json({ success: false, message: 'Aucun paiement trouvé' });

    res.json({ success: true, data: payToDto(payment) });
  } catch (err) { next(err); }
}

// ─── POST /payments/:id/confirm — webhook or manual confirm ──────────────────
function confirm(req, res, next) {
  try {
    const payment = db.prepare('SELECT * FROM payments WHERE id=?').get(req.params.id);
    if (!payment) return res.status(404).json({ success: false, message: 'Paiement introuvable' });
    if (payment.status === 'COMPLETED')
      return res.json({ success: true, message: 'Déjà confirmé' });

    db.prepare('UPDATE payments SET status=\'COMPLETED\', completed_at=datetime(\'now\') WHERE id=?').run(payment.id);
    db.prepare('UPDATE reservations SET status=\'COMPLETED\', updated_at=datetime(\'now\') WHERE id=?').run(payment.reservation_id);

    res.json({ success: true, message: 'Paiement confirmé' });
  } catch (err) { next(err); }
}

// ─── Admin: GET /payments/stats ───────────────────────────────────────────────
function stats(req, res, next) {
  try {
    const s = db.prepare(`
      SELECT
        COUNT(*) as total_payments,
        SUM(CASE WHEN status='COMPLETED' THEN 1 ELSE 0 END) as completed,
        SUM(CASE WHEN status='PENDING'   THEN 1 ELSE 0 END) as pending,
        SUM(CASE WHEN status='COMPLETED' THEN amount ELSE 0 END) as total_revenue,
        SUM(CASE WHEN status='COMPLETED' THEN commission ELSE 0 END) as total_commission
      FROM payments
    `).get();
    res.json({ success: true, data: s });
  } catch (err) { next(err); }
}

// ─── DTO ──────────────────────────────────────────────────────────────────────
function payToDto(p) {
  return {
    id:             p.id,
    reservationId:  p.reservation_id,
    method:         p.method,
    amount:         p.amount,
    commission:     p.commission,
    commissionRate: p.commission_rate,
    status:         p.status,
    waveRef:        p.wave_ref,
    orangeRef:      p.orange_ref,
    checkoutUrl:    p.checkout_url,
    failureReason:  p.failure_reason,
    createdAt:      p.created_at,
    completedAt:    p.completed_at,
  };
}

module.exports = { initiate, getByReservation, confirm, stats };
