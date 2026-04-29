const router = require('express').Router();
const ctrl   = require('../controllers/pharmacies.controller');
const { authenticate, requireRole, optionalAuth } = require('../middleware/auth');

// GET /api/v1/pharmacies/nearby
router.get('/nearby', ctrl.nearby);

// GET /api/v1/pharmacies/me — pharmacy staff's own pharmacy
router.get('/me', authenticate, requireRole('PHARMACY_STAFF', 'ADMIN'), ctrl.myPharmacy);

// GET /api/v1/pharmacies
router.get('/', optionalAuth, ctrl.list);

// GET /api/v1/pharmacies/:id
router.get('/:id', ctrl.getById);

// GET /api/v1/pharmacies/:id/stock
router.get('/:id/stock', optionalAuth, ctrl.getStock);

// PUT /api/v1/pharmacies/:id/stock/:medicationId — pharmacy staff or admin
router.put('/:id/stock/:medicationId',
  authenticate,
  requireRole('PHARMACY_STAFF', 'ADMIN'),
  ctrl.updateStock
);

module.exports = router;
