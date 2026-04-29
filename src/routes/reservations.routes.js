const router = require('express').Router();
const { body, validationResult } = require('express-validator');
const ctrl   = require('../controllers/reservations.controller');
const { authenticate, requireRole } = require('../middleware/auth');

function validate(req, res, next) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(422).json({ success: false, errors: errors.array() });
  next();
}

// POST /api/v1/reservations
router.post('/',
  authenticate,
  requireRole('PATIENT', 'ADMIN'),
  body('pharmacyId').notEmpty(),
  body('medicationId').notEmpty(),
  body('quantity').isInt({ min: 1 }).withMessage('Quantité min 1'),
  validate,
  ctrl.create
);

// GET /api/v1/reservations — patient's own
router.get('/', authenticate, requireRole('PATIENT', 'ADMIN'), ctrl.myReservations);

// GET /api/v1/reservations/pharmacy — pharmacy staff
router.get('/pharmacy', authenticate, requireRole('PHARMACY_STAFF', 'ADMIN'), ctrl.pharmacyReservations);

// GET /api/v1/reservations/all — admin
router.get('/all', authenticate, requireRole('ADMIN'), ctrl.all);

// GET /api/v1/reservations/:id
router.get('/:id', authenticate, ctrl.getById);

// POST /api/v1/reservations/:id/cancel
router.post('/:id/cancel', authenticate, ctrl.cancel);

// POST /api/v1/reservations/:id/ready
router.post('/:id/ready', authenticate, requireRole('PHARMACY_STAFF', 'ADMIN'), ctrl.markReady);

// POST /api/v1/reservations/:id/complete
router.post('/:id/complete', authenticate, requireRole('PHARMACY_STAFF', 'ADMIN'), ctrl.complete);

module.exports = router;
