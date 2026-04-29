const jwt = require('jsonwebtoken');
const db   = require('../database/db');

const JWT_SECRET = process.env.JWT_SECRET || 'medoq-secret';

// ─── Verify access token ──────────────────────────────────────────────────────
function authenticate(req, res, next) {
  const header = req.headers['authorization'];
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, message: 'Token manquant' });
  }

  const token = header.split(' ')[1];
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    // Attach minimal user info to request
    req.user = { id: payload.sub, role: payload.role, phone: payload.phone };
    next();
  } catch (err) {
    return res.status(401).json({ success: false, message: 'Token invalide ou expiré' });
  }
}

// ─── Role guard factory ───────────────────────────────────────────────────────
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ success: false, message: 'Accès refusé' });
    }
    next();
  };
}

// ─── Optional auth (doesn't fail if no token) ────────────────────────────────
function optionalAuth(req, res, next) {
  const header = req.headers['authorization'];
  if (header && header.startsWith('Bearer ')) {
    try {
      const payload = jwt.verify(header.split(' ')[1], JWT_SECRET);
      req.user = { id: payload.sub, role: payload.role };
    } catch (_) { /* ignore */ }
  }
  next();
}

module.exports = { authenticate, requireRole, optionalAuth };
