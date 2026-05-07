require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const path    = require('path');

// ─── Auto-seed if DB is empty ─────────────────────────────────────────────────
try {
  const db = require('./src/database/db');
  const userCount  = db.prepare('SELECT COUNT(*) as cnt FROM users').get().cnt;
  const pharmaCount = db.prepare('SELECT COUNT(*) as cnt FROM pharmacies').get().cnt;
  if (userCount === 0 || pharmaCount < 8) {
    console.log('Seeding database...');
    require('./src/database/seed');
  } else {
    console.log(`OK — ${userCount} users, ${pharmaCount} pharmacies`);
  }
} catch (e) { console.error('Seed error:', e.message); }

const { errorHandler, notFound } = require('./src/middleware/errorHandler');

const authRoutes         = require('./src/routes/auth.routes');
const medicationsRoutes  = require('./src/routes/medications.routes');
const pharmaciesRoutes   = require('./src/routes/pharmacies.routes');
const reservationsRoutes = require('./src/routes/reservations.routes');
const paymentsRoutes     = require('./src/routes/payments.routes');

const app  = express();
const PORT = process.env.PORT || 8080;

// ─── Middlewares ──────────────────────────────────────────────────────────────
app.use(cors({
  origin: ['https://niangamadou394-star.github.io', 'http://localhost:3000', 'http://localhost:8080', /\.netlify\.app$/, /\.onrender\.com$/],
  credentials: true,
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ─── Health check ─────────────────────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'medoq-api', version: '1.0.0', timestamp: new Date().toISOString() });
});

// ─── API Routes ───────────────────────────────────────────────────────────────
app.use('/api/v1/auth',         authRoutes);
app.use('/api/v1/medications',  medicationsRoutes);
app.use('/api/v1/pharmacies',   pharmaciesRoutes);
app.use('/api/v1/reservations', reservationsRoutes);
app.use('/api/v1/payments',     paymentsRoutes);

// ─── Static web app ───────────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, 'public')));

// SPA fallback — serve index.html for any non-API route
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ─── Error handling ───────────────────────────────────────────────────────────
app.use(notFound);
app.use(errorHandler);

// ─── Start ────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🚀 Medoq API démarrée sur http://localhost:${PORT}`);
  console.log(`📋 Endpoints disponibles sur http://localhost:${PORT}/`);
  console.log(`🏥 Environment: ${process.env.NODE_ENV || 'development'}\n`);
});

module.exports = app;
