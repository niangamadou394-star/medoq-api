const router = require('express').Router();
const { body, validationResult } = require('express-validator');
const ctrl   = require('../controllers/payments.controller');
const { authenticate, requireRole } = require('../middleware/auth');

function validate(req, res, next) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(422).json({ success: false, errors: errors.array() });
  next();
}

// POST /api/v1/payments/initiate
router.post('/initiate',
  authenticate,
  body('reservationId').notEmpty(),
  body('method').isIn(['WAVE', 'ORANGE_MONEY', 'CASH']).withMessage('Méthode invalide'),
  validate,
  ctrl.initiate
);

// GET /api/v1/payments/stats (admin)
router.get('/stats', authenticate, requireRole('ADMIN'), ctrl.stats);

// GET /api/v1/payments/reservation/:reservationId
router.get('/reservation/:reservationId', authenticate, ctrl.getByReservation);

// POST /api/v1/payments/:id/confirm
router.post('/:id/confirm', authenticate, requireRole('ADMIN', 'PHARMACY_STAFF'), ctrl.confirm);

module.exports = router;
