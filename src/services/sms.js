require('dotenv').config();

let _sms = null;

function getSmsService() {
  if (_sms) return _sms;

  const apiKey   = process.env.AT_API_KEY;
  const username = process.env.AT_USERNAME;

  if (!apiKey || !username) {
    // Dev mode: log OTPs to console
    _sms = null;
    return null;
  }

  try {
    const AfricasTalking = require('africastalking');
    const at = AfricasTalking({ apiKey, username });
    _sms = at.SMS;
    return _sms;
  } catch (err) {
    console.error('Africa\'s Talking init error:', err.message);
    return null;
  }
}

// ─── Send SMS ─────────────────────────────────────────────────────────────────
async function sendSms(to, message) {
  const sms = getSmsService();

  if (!sms) {
    // Dev fallback — print to console
    console.log(`\n📱 [SMS DEV] To: ${to}\n   Message: ${message}\n`);
    return { status: 'dev', to, message };
  }

  try {
    const result = await sms.send({
      to: Array.isArray(to) ? to : [to],
      message,
      from: process.env.AT_SENDER_ID || 'Medoq',
    });
    return result;
  } catch (err) {
    console.error(`SMS send error to ${to}:`, err.message);
    throw err;
  }
}

// ─── OTP SMS templates ────────────────────────────────────────────────────────
async function sendOtpSms(phone, code, purpose = 'REGISTER') {
  const messages = {
    REGISTER: `Medoq: Votre code de verification est ${code}. Valide 10 minutes. Ne le partagez pas.`,
    RESET:    `Medoq: Code de reinitialisation: ${code}. Valide 10 minutes. Ne le partagez pas.`,
  };
  const message = messages[purpose] || messages.REGISTER;
  return sendSms(phone, message);
}

// ─── Reservation notification templates ──────────────────────────────────────
async function sendReservationConfirmed(phone, refNumber, pharmacyName, medName) {
  const message = `Medoq: Reservation ${refNumber} confirmee! ${medName} disponible a ${pharmacyName}. Presentez-vous avec ce code.`;
  return sendSms(phone, message);
}

async function sendReservationReady(phone, refNumber, pharmacyName) {
  const message = `Medoq: Votre commande ${refNumber} est prete! Venez la recuperer a ${pharmacyName}.`;
  return sendSms(phone, message);
}

module.exports = { sendSms, sendOtpSms, sendReservationConfirmed, sendReservationReady };
