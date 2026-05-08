const { v4: uuidv4 } = require('uuid');
const pool = require('../database/db');

const COMMISSION_RATE = parseFloat(process.env.COMMISSION_RATE) || 1.5;

// ─── POST /payments/initiate ──────────────────────────────────────────────────
async function initiate(req, res, next) {
  try {
    const { reservationId, method } = req.body;

    const { rows: resaRows } = await pool.query('SELECT * FROM reservations WHERE id=$1', [reservationId]);
    const resa = resaRows[0];
    if (!resa) return res.status(404).json({ success: false, message: 'Réservation introuvable' });
    if (req.user.role === 'PATIENT' && resa.patient_id !== req.user.id) {
      return res.status(403).json({ success: false, message: 'Accès refusé' });
    }
    if (!['CONFIRMED', 'READY'].includes(resa.status)) {
      return res.status(400).json({ success: false, message: `Paiement impossible pour le statut: ${resa.status}` });
    }

    const { rows: payRows } = await pool.query('SELECT * FROM payments WHERE reservation_id=$1', [reservationId]);
    const existing = payRows[0];
    if (existing && existing.status === 'COMPLETED') {
      return res.status(400).json({ success: false, message: 'Déjà payé' });
    }

    const amount     = resa.total_amount;
    const commission = Math.round(amount * COMMISSION_RATE) / 100;
    const id         = uuidv4();
    const now        = new Date().toISOString();

    if (method === 'CASH') {
      if (existing) {
        await pool.query(
          "UPDATE payments SET status='COMPLETED', completed_at=$1 WHERE id=$2",
          [now, existing.id]
        );
      } else {
        await pool.query(
          `INSERT INTO payments (id, reservation_id, method, amount, commission, commission_rate, status, completed_at)
           VALUES ($1,$2,$3,$4,$5,$6,'COMPLETED',$7)`,
          [id, reservationId, 'CASH', amount, commission, COMMISSION_RATE, now]
        );
      }
      await pool.query(
        'UPDATE reservations SET status=$1, updated_at=$2 WHERE id=$3',
        ['COMPLETED', now, reservationId]
      );
      return res.json({ success: true, message: 'Paiement cash enregistré', data: { method: 'CASH', status: 'COMPLETED', amount } });
    }

    // Mobile money
    const fakeCheckoutUrl = `https://pay.medoq.sn/checkout/${id}?method=${method}&amount=${amount}`;
    const payRef          = `${method}-${Date.now()}`;

    if (existing) {
      await pool.query(
        "UPDATE payments SET method=$1, wave_ref=$2, orange_ref=$3, checkout_url=$4, status='PENDING' WHERE id=$5",
        [method,
         method === 'WAVE'         ? payRef : null,
         method === 'ORANGE_MONEY' ? payRef : null,
         fakeCheckoutUrl,
         existing.id]
      );
    } else {
      await pool.query(
        `INSERT INTO payments (id, reservation_id, method, amount, commission, commission_rate, status, wave_ref, orange_ref, checkout_url)
         VALUES ($1,$2,$3,$4,$5,$6,'PENDING',$7,$8,$9)`,
        [id, reservationId, method, amount, commission, COMMISSION_RATE,
         method === 'WAVE'         ? payRef : null,
         method === 'ORANGE_MONEY' ? payRef : null,
         fakeCheckoutUrl]
      );
    }

    res.json({
      success: true,
      message: 'Paiement initié',
      data: {
        paymentId:   existing?.id || id,
        method,
        status:      'PENDING',
        amount,
        commission,
        checkoutUrl: fakeCheckoutUrl,
      }
    });
  } catch (err) { next(err); }
}

// ─── GET /payments/reservation/:reservationId ─────────────────────────────────
async function getByReservation(req, res, next) {
  try {
    const { rows: resaRows } = await pool.query('SELECT * FROM reservations WHERE id=$1', [req.params.reservationId]);
    const resa = resaRows[0];
    if (!resa) return res.status(404).json({ success: false, message: 'Réservation introuvable' });
    if (req.user.role === 'PATIENT' && resa.patient_id !== req.user.id) {
      return res.status(403).json({ success: false, message: 'Accès refusé' });
    }

    const { rows: payRows } = await pool.query('SELECT * FROM payments WHERE reservation_id=$1', [req.params.reservationId]);
    if (!payRows[0]) return res.status(404).json({ success: false, message: 'Aucun paiement trouvé' });

    res.json({ success: true, data: payToDto(payRows[0]) });
  } catch (err) { next(err); }
}

// ─── POST /payments/:id/confirm ───────────────────────────────────────────────
async function confirm(req, res, next) {
  try {
    const { rows } = await pool.query('SELECT * FROM payments WHERE id=$1', [req.params.id]);
    const payment  = rows[0];
    if (!payment) return res.status(404).json({ success: false, message: 'Paiement introuvable' });
    if (payment.status === 'COMPLETED') return res.json({ success: true, message: 'Déjà confirmé' });

    const now = new Date().toISOString();
    await pool.query("UPDATE payments SET status='COMPLETED', completed_at=$1 WHERE id=$2", [now, payment.id]);
    await pool.query('UPDATE reservations SET status=$1, updated_at=$2 WHERE id=$3', ['COMPLETED', now, payment.reservation_id]);

    res.json({ success: true, message: 'Paiement confirmé' });
  } catch (err) { next(err); }
}

// ─── Admin: GET /payments/stats ───────────────────────────────────────────────
async function stats(req, res, next) {
  try {
    const { rows } = await pool.query(`
      SELECT
        COUNT(*)                                                            as total_payments,
        SUM(CASE WHEN status='COMPLETED' THEN 1 ELSE 0 END)                as completed,
        SUM(CASE WHEN status='PENDING'   THEN 1 ELSE 0 END)                as pending,
        COALESCE(SUM(CASE WHEN status='COMPLETED' THEN amount ELSE 0 END), 0)     as total_revenue,
        COALESCE(SUM(CASE WHEN status='COMPLETED' THEN commission ELSE 0 END), 0) as total_commission
      FROM payments
    `);
    res.json({ success: true, data: rows[0] });
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
