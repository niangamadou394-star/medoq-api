const router  = require('express').Router();
const { body, validationResult } = require('express-validator');
const ctrl    = require('../controllers/auth.controller');
const { authenticate } = require('../middleware/auth');

// ─── Validation helper ────────────────────────────────────────────────────────
function validate(req, res, next) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(422).json({ success: false, message: 'Validation échouée', errors: errors.array() });
  }
  next();
}

// POST /api/v1/auth/send-otp
router.post('/send-otp',
  body('phone').notEmpty().withMessage('Téléphone requis'),
  validate,
  ctrl.sendOtp
);

// POST /api/v1/auth/register
router.post('/register',
  body('phone').notEmpty().withMessage('Téléphone requis'),
  body('name').notEmpty().withMessage('Nom requis'),
  body('password').isLength({ min: 6 }).withMessage('Mot de passe min 6 caractères'),
  validate,
  ctrl.register
);

// POST /api/v1/auth/login
router.post('/login',
  body('phone').notEmpty().withMessage('Téléphone requis'),
  body('password').notEmpty().withMessage('Mot de passe requis'),
  validate,
  ctrl.login
);

// POST /api/v1/auth/refresh
router.post('/refresh',
  body('refreshToken').notEmpty().withMessage('refreshToken requis'),
  validate,
  ctrl.refresh
);

// POST /api/v1/auth/logout
router.post('/logout', ctrl.logout);

// GET /api/v1/auth/me
router.get('/me', authenticate, ctrl.me);

// PUT /api/v1/auth/me
router.put('/me', authenticate, ctrl.updateMe);

// POST /api/v1/auth/forgot-password
router.post('/forgot-password',
  body('phone').notEmpty().withMessage('Téléphone requis'),
  validate,
  ctrl.forgotPassword
);

// POST /api/v1/auth/reset-password
router.post('/reset-password',
  body('phone').notEmpty().withMessage('Téléphone requis'),
  body('otp').notEmpty().withMessage('Code OTP requis'),
  body('newPassword').isLength({ min: 6 }).withMessage('Mot de passe min 6 caractères'),
  validate,
  ctrl.resetPassword
);

module.exports = router;
