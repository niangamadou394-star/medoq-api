/**
 * Service email Medoq (Nodemailer)
 *
 * En production, configurez SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS
 * dans les variables d'environnement Render.
 *
 * Option recommandée (gratuite) : Gmail avec un mot de passe d'application.
 *   1. Activez la validation en 2 étapes sur votre Gmail
 *   2. Allez dans Compte Google > Sécurité > Mots de passe d'application
 *   3. Créez un mot de passe pour "Medoq"
 *   4. Renseignez SMTP_USER=niangamadou394@gmail.com et SMTP_PASS=<mot-de-passe-app>
 */
require('dotenv').config();
let _transporter = null;

async function getTransporter() {
  if (_transporter) return _transporter;

  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!user || !pass) {
    return null; // mode dev : log dans la console
  }

  try {
    const nodemailer = require('nodemailer');
    _transporter = nodemailer.createTransport({
      host:   process.env.SMTP_HOST   || 'smtp.gmail.com',
      port:   parseInt(process.env.SMTP_PORT || '465'),
      secure: process.env.SMTP_PORT   ? parseInt(process.env.SMTP_PORT) === 465 : true,
      auth: { user, pass },
    });
    return _transporter;
  } catch (err) {
    console.error('Email init error:', err.message);
    return null;
  }
}

// ─── Envoi d'un email ─────────────────────────────────────────────────────────
async function sendEmail({ to, subject, html, text }) {
  const transporter = await getTransporter();
  const from = process.env.SMTP_USER || 'niangamadou394@gmail.com';

  if (!transporter) {
    console.log(`\n📧 [EMAIL DEV] To: ${to}\n   Subject: ${subject}\n   ${text || ''}\n`);
    return { status: 'dev' };
  }

  return transporter.sendMail({ from: `Medoq <${from}>`, to, subject, html, text });
}

// ─── Notification : nouvelle pharmacie en attente ─────────────────────────────
async function notifyNewPharmacyRequest({ pharmacyName, address, licenseNumber, staffName, staffPhone, pharmacyId }) {
  const adminEmail = process.env.ADMIN_EMAIL || 'niangamadou394@gmail.com';

  const html = `
    <div style="font-family:sans-serif;max-width:540px;margin:0 auto;background:#f8f9fa;padding:32px;border-radius:12px">
      <div style="text-align:center;margin-bottom:24px">
        <span style="font-size:28px;font-weight:900;color:#0A0E1A">Med<span style="color:#00D4AA">oq</span></span>
      </div>
      <h2 style="color:#0A0E1A;font-size:20px;margin-bottom:16px">Nouvelle demande d'inscription pharmacie</h2>
      <table style="width:100%;border-collapse:collapse;font-size:14px">
        <tr><td style="padding:10px;background:#fff;border-radius:6px;color:#555;width:40%"><strong>Pharmacie</strong></td><td style="padding:10px;background:#fff;color:#0A0E1A">${pharmacyName}</td></tr>
        <tr><td style="padding:10px;color:#555"><strong>Adresse</strong></td><td style="padding:10px;color:#0A0E1A">${address}</td></tr>
        <tr><td style="padding:10px;background:#fff;color:#555"><strong>Licence</strong></td><td style="padding:10px;background:#fff;color:#0A0E1A">${licenseNumber}</td></tr>
        <tr><td style="padding:10px;color:#555"><strong>Responsable</strong></td><td style="padding:10px;color:#0A0E1A">${staffName}</td></tr>
        <tr><td style="padding:10px;background:#fff;color:#555"><strong>Téléphone</strong></td><td style="padding:10px;background:#fff;color:#0A0E1A">${staffPhone}</td></tr>
        <tr><td style="padding:10px;color:#555"><strong>ID</strong></td><td style="padding:10px;font-size:11px;color:#999">${pharmacyId}</td></tr>
      </table>
      <div style="margin-top:24px;text-align:center">
        <a href="https://medoq-api.onrender.com" style="display:inline-block;background:linear-gradient(135deg,#0066FF,#00D4AA);color:#fff;padding:14px 28px;border-radius:24px;text-decoration:none;font-weight:700;font-size:14px">
          Ouvrir l'app pour valider
        </a>
      </div>
      <p style="margin-top:20px;font-size:12px;color:#999;text-align:center">
        Vous êtes l'administrateur Medoq · niangamadou394@gmail.com
      </p>
    </div>
  `;

  return sendEmail({
    to: adminEmail,
    subject: `[Medoq] Nouvelle pharmacie en attente : ${pharmacyName}`,
    text: `Nouvelle demande d'inscription : ${pharmacyName} - ${address} - Responsable: ${staffName} (${staffPhone}) - Licence: ${licenseNumber}`,
    html,
  });
}

module.exports = { sendEmail, notifyNewPharmacyRequest };
