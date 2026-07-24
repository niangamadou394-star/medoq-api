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

// Exige au moins un des deux champs (phone OU email) et valide leur format si présents.
function phoneOrEmailRequired(req, res, next) {
  const phone = (req.body?.phone || '').trim();
  const email = (req.body?.email || '').trim();
  if (!phone && !email) {
    return res.status(422).json({ success: false, message: 'Téléphone ou email requis' });
  }
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(422).json({ success: false, message: 'Email invalide' });
  }
  // Normalisation légère du phone (garde le + international)
  if (phone) req.body.phone = phone.replace(/[\s\-\.]/g, '');
  if (email) req.body.email = email.toLowerCase();
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
  body('email').optional({ checkFalsy: true })
    .matches(/^[^\s@]+@[^\s@]+\.[^\s@]+$/).withMessage('Email invalide'),
  validate,
  ctrl.register
);

// POST /api/v1/auth/login
router.post('/login',
  body('password').notEmpty().withMessage('Mot de passe requis'),
  phoneOrEmailRequired,
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
