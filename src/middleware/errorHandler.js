// ─── Global error handler ────────────────────────────────────────────────────
function errorHandler(err, req, res, next) {
  console.error(`[ERROR] ${req.method} ${req.path} →`, err.message || err);

  // express-validator errors come via validationResult, but just in case:
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ success: false, message: 'JSON invalide' });
  }

  const status  = err.status  || err.statusCode || 500;
  const message = err.message || 'Erreur interne du serveur';

  res.status(status).json({ success: false, message });
}

// ─── 404 catch-all ───────────────────────────────────────────────────────────
function notFound(req, res) {
  res.status(404).json({ success: false, message: `Route ${req.method} ${req.path} introuvable` });
}

module.exports = { errorHandler, notFound };
