const bcrypt  = require('bcrypt');
const jwt     = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const db      = require('../database/db');

const JWT_SECRET          = process.env.JWT_SECRET          || 'medoq-secret';
const JWT_EXPIRES_IN      = parseInt(process.env.JWT_EXPIRES_IN)      || 86400;
const JWT_REFRESH_EXPIRES = parseInt(process.env.JWT_REFRESH_EXPIRES_IN) || 604800;

// ─── Helpers ─────────────────────────────────────────────────────────────────
function makeAccessToken(user) {
  return jwt.sign(
    { sub: user.id, role: user.role, phone: user.phone },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN }
  );
}

function makeRefreshToken(userId) {
  const token    = uuidv4() + uuidv4();
  const expiresAt = new Date(Date.now() + JWT_REFRESH_EXPIRES * 1000).toISOString();
  db.prepare('INSERT INTO refresh_tokens (id, user_id, token, expires_at) VALUES (?, ?, ?, ?)')
    .run(uuidv4(), userId, token, expiresAt);
  return token;
}

function userToDto(user) {
  return {
    id:        user.id,
    phone:     user.phone,
    email:     user.email,
    name:      user.name,
    role:      user.role,
    isActive:  !!user.is_active,
    createdAt: user.created_at,
  };
}

// ─── POST /auth/register ──────────────────────────────────────────────────────
async function register(req, res, next) {
  try {
    const { phone, email, name, password } = req.body;

    const existing = db.prepare('SELECT id FROM users WHERE phone = ? OR (email IS NOT NULL AND email = ?)').get(phone, email || '');
    if (existing) {
      return res.status(409).json({ success: false, message: 'Numéro de téléphone ou email déjà utilisé' });
    }

    const hash = await bcrypt.hash(password, 10);
    const id   = uuidv4();
    db.prepare('INSERT INTO users (id, phone, email, name, password_hash, role) VALUES (?, ?, ?, ?, ?, ?)')
      .run(id, phone, email || null, name, hash, 'PATIENT');

    const user         = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
    const accessToken  = makeAccessToken(user);
    const refreshToken = makeRefreshToken(user.id);

    res.status(201).json({
      success: true,
      data: { user: userToDto(user), accessToken, refreshToken, expiresIn: JWT_EXPIRES_IN }
    });
  } catch (err) { next(err); }
}

// ─── POST /auth/login ─────────────────────────────────────────────────────────
async function login(req, res, next) {
  try {
    const { phone, password } = req.body;

    const user = db.prepare('SELECT * FROM users WHERE phone = ?').get(phone);
    if (!user) {
      return res.status(401).json({ success: false, message: 'Identifiants incorrects' });
    }

    if (user.is_blocked) {
      if (user.blocked_until && new Date(user.blocked_until) > new Date()) {
        return res.status(403).json({ success: false, message: 'Compte temporairement bloqué' });
      }
      // unblock if time has passed
      db.prepare('UPDATE users SET is_blocked=0, failed_login_attempts=0, blocked_until=NULL WHERE id=?').run(user.id);
    }

    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) {
      const attempts = user.failed_login_attempts + 1;
      if (attempts >= 5) {
        const blockedUntil = new Date(Date.now() + 15 * 60 * 1000).toISOString();
        db.prepare('UPDATE users SET failed_login_attempts=?, is_blocked=1, blocked_until=? WHERE id=?')
          .run(attempts, blockedUntil, user.id);
        return res.status(403).json({ success: false, message: 'Trop de tentatives. Compte bloqué 15 minutes.' });
      }
      db.prepare('UPDATE users SET failed_login_attempts=? WHERE id=?').run(attempts, user.id);
      return res.status(401).json({ success: false, message: 'Identifiants incorrects' });
    }

    // Reset failed attempts
    db.prepare('UPDATE users SET failed_login_attempts=0, is_blocked=0, blocked_until=NULL WHERE id=?').run(user.id);

    const accessToken  = makeAccessToken(user);
    const refreshToken = makeRefreshToken(user.id);

    // Pharmacy link
    const phLink = db.prepare('SELECT pharmacy_id FROM pharmacy_users WHERE user_id=? AND is_active=1').get(user.id);

    res.json({
      success: true,
      data: {
        user:       userToDto(user),
        pharmacyId: phLink ? phLink.pharmacy_id : null,
        accessToken,
        refreshToken,
        expiresIn: JWT_EXPIRES_IN
      }
    });
  } catch (err) { next(err); }
}

// ─── POST /auth/refresh ───────────────────────────────────────────────────────
function refresh(req, res, next) {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken) return res.status(400).json({ success: false, message: 'refreshToken requis' });

    const stored = db.prepare('SELECT * FROM refresh_tokens WHERE token=?').get(refreshToken);
    if (!stored || new Date(stored.expires_at) < new Date()) {
      if (stored) db.prepare('DELETE FROM refresh_tokens WHERE id=?').run(stored.id);
      return res.status(401).json({ success: false, message: 'Refresh token invalide ou expiré' });
    }

    const user = db.prepare('SELECT * FROM users WHERE id=?').get(stored.user_id);
    if (!user || !user.is_active) {
      return res.status(401).json({ success: false, message: 'Utilisateur introuvable' });
    }

    // Rotate refresh token
    db.prepare('DELETE FROM refresh_tokens WHERE id=?').run(stored.id);
    const newRefresh = makeRefreshToken(user.id);
    const newAccess  = makeAccessToken(user);

    res.json({ success: true, data: { accessToken: newAccess, refreshToken: newRefresh, expiresIn: JWT_EXPIRES_IN } });
  } catch (err) { next(err); }
}

// ─── POST /auth/logout ────────────────────────────────────────────────────────
function logout(req, res, next) {
  try {
    const { refreshToken } = req.body;
    if (refreshToken) db.prepare('DELETE FROM refresh_tokens WHERE token=?').run(refreshToken);
    res.json({ success: true, message: 'Déconnexion réussie' });
  } catch (err) { next(err); }
}

// ─── GET /auth/me ─────────────────────────────────────────────────────────────
function me(req, res, next) {
  try {
    const user = db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id);
    if (!user) return res.status(404).json({ success: false, message: 'Utilisateur introuvable' });

    const phLink = db.prepare('SELECT pharmacy_id FROM pharmacy_users WHERE user_id=? AND is_active=1').get(user.id);
    res.json({ success: true, data: { ...userToDto(user), pharmacyId: phLink ? phLink.pharmacy_id : null } });
  } catch (err) { next(err); }
}

// ─── PUT /auth/me ─────────────────────────────────────────────────────────────
async function updateMe(req, res, next) {
  try {
    const { name, email } = req.body;
    db.prepare('UPDATE users SET name=COALESCE(?,name), email=COALESCE(?,email), updated_at=datetime(\'now\') WHERE id=?')
      .run(name || null, email || null, req.user.id);
    const user = db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id);
    res.json({ success: true, data: userToDto(user) });
  } catch (err) { next(err); }
}

module.exports = { register, login, refresh, logout, me, updateMe };
