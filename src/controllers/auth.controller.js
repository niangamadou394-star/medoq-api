const bcrypt  = require('bcrypt');
const jwt     = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const pool    = require('../database/db');
const { sendOtpSms } = require('../services/sms');

const JWT_SECRET          = process.env.JWT_SECRET          || 'medoq-secret';
const JWT_EXPIRES_IN      = parseInt(process.env.JWT_EXPIRES_IN)        || 86400;
const JWT_REFRESH_EXPIRES = parseInt(process.env.JWT_REFRESH_EXPIRES_IN) || 604800;
const OTP_TTL_MIN         = 10;

// ─── Helpers ──────────────────────────────────────────────────────────────────
function makeAccessToken(user) {
  return jwt.sign(
    { sub: user.id, role: user.role, phone: user.phone },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN }
  );
}

async function makeRefreshToken(userId) {
  const token     = uuidv4() + uuidv4();
  const expiresAt = new Date(Date.now() + JWT_REFRESH_EXPIRES * 1000).toISOString();
  await pool.query(
    'INSERT INTO refresh_tokens (id, user_id, token, expires_at) VALUES ($1, $2, $3, $4)',
    [uuidv4(), userId, token, expiresAt]
  );
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

// ─── POST /auth/send-otp ──────────────────────────────────────────────────────
async function sendOtp(req, res, next) {
  try {
    const { phone, purpose = 'REGISTER' } = req.body;
    if (!phone) return res.status(400).json({ success: false, message: 'Numéro requis' });

    if (purpose === 'REGISTER') {
      const { rows } = await pool.query('SELECT id FROM users WHERE phone=$1', [phone]);
      if (rows.length > 0) {
        return res.status(409).json({ success: false, message: 'Numéro déjà utilisé' });
      }
    }
    if (purpose === 'RESET') {
      const { rows } = await pool.query('SELECT id FROM users WHERE phone=$1', [phone]);
      if (rows.length === 0) {
        return res.status(404).json({ success: false, message: 'Numéro introuvable' });
      }
    }

    const code      = String(Math.floor(100000 + Math.random() * 900000));
    const expiresAt = new Date(Date.now() + OTP_TTL_MIN * 60 * 1000).toISOString();

    // Invalidate previous OTPs for this phone+purpose
    await pool.query(
      "UPDATE otp_codes SET used=1 WHERE phone=$1 AND purpose=$2 AND used=0",
      [phone, purpose]
    );

    await pool.query(
      'INSERT INTO otp_codes (id, phone, code, purpose, expires_at) VALUES ($1, $2, $3, $4, $5)',
      [uuidv4(), phone, code, purpose, expiresAt]
    );

    await sendOtpSms(phone, code, purpose);

    res.json({ success: true, message: `Code envoyé au ${phone}` });
  } catch (err) { next(err); }
}

// ─── POST /auth/register ──────────────────────────────────────────────────────
async function register(req, res, next) {
  try {
    const { phone, email, name, password, otp } = req.body;

    // OTP check (required in production, optional in dev)
    const otpRequired = process.env.NODE_ENV === 'production' || process.env.OTP_REQUIRED === 'true';
    if (otpRequired) {
      if (!otp) return res.status(400).json({ success: false, message: 'Code OTP requis' });
      const { rows } = await pool.query(
        "SELECT * FROM otp_codes WHERE phone=$1 AND purpose='REGISTER' AND used=0 ORDER BY created_at DESC LIMIT 1",
        [phone]
      );
      const otpRecord = rows[0];
      if (!otpRecord || otpRecord.code !== String(otp) || new Date(otpRecord.expires_at) < new Date()) {
        return res.status(400).json({ success: false, message: 'Code OTP invalide ou expiré' });
      }
      await pool.query('UPDATE otp_codes SET used=1 WHERE id=$1', [otpRecord.id]);
    }

    const { rows: existing } = await pool.query(
      'SELECT id FROM users WHERE phone=$1 OR (email IS NOT NULL AND email=$2)',
      [phone, email || '']
    );
    if (existing.length > 0) {
      return res.status(409).json({ success: false, message: 'Numéro ou email déjà utilisé' });
    }

    const hash = await bcrypt.hash(password, 10);
    const id   = uuidv4();
    await pool.query(
      'INSERT INTO users (id, phone, email, name, password_hash, role) VALUES ($1, $2, $3, $4, $5, $6)',
      [id, phone, email || null, name, hash, 'PATIENT']
    );

    const { rows } = await pool.query('SELECT * FROM users WHERE id=$1', [id]);
    const user         = rows[0];
    const accessToken  = makeAccessToken(user);
    const refreshToken = await makeRefreshToken(user.id);

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

    const { rows } = await pool.query('SELECT * FROM users WHERE phone=$1', [phone]);
    const user = rows[0];
    if (!user) {
      return res.status(401).json({ success: false, message: 'Identifiants incorrects' });
    }

    if (user.is_blocked) {
      if (user.blocked_until && new Date(user.blocked_until) > new Date()) {
        return res.status(403).json({ success: false, message: 'Compte temporairement bloqué' });
      }
      await pool.query(
        'UPDATE users SET is_blocked=0, failed_login_attempts=0, blocked_until=NULL WHERE id=$1',
        [user.id]
      );
    }

    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) {
      const attempts = user.failed_login_attempts + 1;
      if (attempts >= 5) {
        const blockedUntil = new Date(Date.now() + 15 * 60 * 1000).toISOString();
        await pool.query(
          'UPDATE users SET failed_login_attempts=$1, is_blocked=1, blocked_until=$2 WHERE id=$3',
          [attempts, blockedUntil, user.id]
        );
        return res.status(403).json({ success: false, message: 'Trop de tentatives. Compte bloqué 15 minutes.' });
      }
      await pool.query('UPDATE users SET failed_login_attempts=$1 WHERE id=$2', [attempts, user.id]);
      return res.status(401).json({ success: false, message: 'Identifiants incorrects' });
    }

    await pool.query(
      'UPDATE users SET failed_login_attempts=0, is_blocked=0, blocked_until=NULL WHERE id=$1',
      [user.id]
    );

    const accessToken  = makeAccessToken(user);
    const refreshToken = await makeRefreshToken(user.id);

    const { rows: phRows } = await pool.query(
      'SELECT pharmacy_id FROM pharmacy_users WHERE user_id=$1 AND is_active=1',
      [user.id]
    );

    res.json({
      success: true,
      data: {
        user:       userToDto(user),
        pharmacyId: phRows[0] ? phRows[0].pharmacy_id : null,
        accessToken,
        refreshToken,
        expiresIn:  JWT_EXPIRES_IN,
      }
    });
  } catch (err) { next(err); }
}

// ─── POST /auth/refresh ───────────────────────────────────────────────────────
async function refresh(req, res, next) {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken) return res.status(400).json({ success: false, message: 'refreshToken requis' });

    const { rows } = await pool.query('SELECT * FROM refresh_tokens WHERE token=$1', [refreshToken]);
    const stored   = rows[0];
    if (!stored || new Date(stored.expires_at) < new Date()) {
      if (stored) await pool.query('DELETE FROM refresh_tokens WHERE id=$1', [stored.id]);
      return res.status(401).json({ success: false, message: 'Refresh token invalide ou expiré' });
    }

    const { rows: uRows } = await pool.query('SELECT * FROM users WHERE id=$1', [stored.user_id]);
    const user = uRows[0];
    if (!user || !user.is_active) {
      return res.status(401).json({ success: false, message: 'Utilisateur introuvable' });
    }

    await pool.query('DELETE FROM refresh_tokens WHERE id=$1', [stored.id]);
    const newRefresh = await makeRefreshToken(user.id);
    const newAccess  = makeAccessToken(user);

    res.json({ success: true, data: { accessToken: newAccess, refreshToken: newRefresh, expiresIn: JWT_EXPIRES_IN } });
  } catch (err) { next(err); }
}

// ─── POST /auth/logout ────────────────────────────────────────────────────────
async function logout(req, res, next) {
  try {
    const { refreshToken } = req.body;
    if (refreshToken) await pool.query('DELETE FROM refresh_tokens WHERE token=$1', [refreshToken]);
    res.json({ success: true, message: 'Déconnexion réussie' });
  } catch (err) { next(err); }
}

// ─── GET /auth/me ─────────────────────────────────────────────────────────────
async function me(req, res, next) {
  try {
    const { rows } = await pool.query('SELECT * FROM users WHERE id=$1', [req.user.id]);
    const user     = rows[0];
    if (!user) return res.status(404).json({ success: false, message: 'Utilisateur introuvable' });

    const { rows: phRows } = await pool.query(
      'SELECT pharmacy_id FROM pharmacy_users WHERE user_id=$1 AND is_active=1',
      [user.id]
    );
    res.json({ success: true, data: { ...userToDto(user), pharmacyId: phRows[0]?.pharmacy_id || null } });
  } catch (err) { next(err); }
}

// ─── PUT /auth/me ─────────────────────────────────────────────────────────────
async function updateMe(req, res, next) {
  try {
    const { name, email } = req.body;
    const now = new Date().toISOString();
    await pool.query(
      'UPDATE users SET name=COALESCE($1, name), email=COALESCE($2, email), updated_at=$3 WHERE id=$4',
      [name || null, email || null, now, req.user.id]
    );
    const { rows } = await pool.query('SELECT * FROM users WHERE id=$1', [req.user.id]);
    res.json({ success: true, data: userToDto(rows[0]) });
  } catch (err) { next(err); }
}

// ─── POST /auth/forgot-password ───────────────────────────────────────────────
async function forgotPassword(req, res, next) {
  try {
    const { phone } = req.body;
    if (!phone) return res.status(400).json({ success: false, message: 'Numéro requis' });

    // Always respond 200 to avoid phone enumeration
    const { rows } = await pool.query('SELECT id FROM users WHERE phone=$1', [phone]);
    if (rows.length > 0) {
      const code      = String(Math.floor(100000 + Math.random() * 900000));
      const expiresAt = new Date(Date.now() + OTP_TTL_MIN * 60 * 1000).toISOString();

      await pool.query(
        "UPDATE otp_codes SET used=1 WHERE phone=$1 AND purpose='RESET' AND used=0",
        [phone]
      );
      await pool.query(
        "INSERT INTO otp_codes (id, phone, code, purpose, expires_at) VALUES ($1, $2, $3, 'RESET', $4)",
        [uuidv4(), phone, code, expiresAt]
      );
      await sendOtpSms(phone, code, 'RESET').catch(() => {});
    }

    res.json({ success: true, message: 'Si ce numéro est enregistré, un code a été envoyé.' });
  } catch (err) { next(err); }
}

// ─── POST /auth/reset-password ────────────────────────────────────────────────
async function resetPassword(req, res, next) {
  try {
    const { phone, otp, newPassword } = req.body;
    if (!phone || !otp || !newPassword) {
      return res.status(400).json({ success: false, message: 'phone, otp et newPassword requis' });
    }
    if (newPassword.length < 6) {
      return res.status(400).json({ success: false, message: 'Mot de passe min 6 caractères' });
    }

    const { rows } = await pool.query(
      "SELECT * FROM otp_codes WHERE phone=$1 AND purpose='RESET' AND used=0 ORDER BY created_at DESC LIMIT 1",
      [phone]
    );
    const record = rows[0];
    if (!record || record.code !== String(otp) || new Date(record.expires_at) < new Date()) {
      return res.status(400).json({ success: false, message: 'Code invalide ou expiré' });
    }

    const hash = await bcrypt.hash(newPassword, 10);
    const now  = new Date().toISOString();
    await pool.query(
      'UPDATE users SET password_hash=$1, updated_at=$2 WHERE phone=$3',
      [hash, now, phone]
    );
    await pool.query('UPDATE otp_codes SET used=1 WHERE id=$1', [record.id]);

    res.json({ success: true, message: 'Mot de passe réinitialisé avec succès' });
  } catch (err) { next(err); }
}

module.exports = { sendOtp, register, login, refresh, logout, me, updateMe, forgotPassword, resetPassword };
