const router = require('express').Router();
const ctrl   = require('../controllers/medications.controller');
const { authenticate, requireRole, optionalAuth } = require('../middleware/auth');

// GET /api/v1/medications
router.get('/', optionalAuth, ctrl.search);

// GET /api/v1/medications/popular
router.get('/popular', ctrl.popular);

// GET /api/v1/medications/categories
router.get('/categories', ctrl.categories);

// GET /api/v1/medications/cmu — médicaments remboursés CMU
router.get('/cmu', ctrl.cmuList);

// GET /api/v1/medications/:id
router.get('/:id', ctrl.getById);

// POST /api/v1/medications (admin only)
router.post('/', authenticate, requireRole('ADMIN'), ctrl.create);

module.exports = router;
