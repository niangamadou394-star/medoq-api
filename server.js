require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const path    = require('path');

const { errorHandler, notFound } = require('./src/middleware/errorHandler');

const authRoutes         = require('./src/routes/auth.routes');
const medicationsRoutes  = require('./src/routes/medications.routes');
const pharmaciesRoutes   = require('./src/routes/pharmacies.routes');
const reservationsRoutes = require('./src/routes/reservations.routes');
const paymentsRoutes     = require('./src/routes/payments.routes');
const adminRoutes        = require('./src/routes/admin.routes');

const app  = express();
const PORT = process.env.PORT || 8080;

// ─── Middlewares ──────────────────────────────────────────────────────────────
app.use(cors({
  origin: [
    'https://niangamadou394-star.github.io',
    'http://localhost:3000',
    'http://localhost:8080',
    /\.netlify\.app$/,
    /\.onrender\.com$/,
  ],
  credentials: true,
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ─── Health check ─────────────────────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'medoq-api', version: '2.0.0', timestamp: new Date().toISOString() });
});

// ─── API Routes ───────────────────────────────────────────────────────────────
app.use('/api/v1/auth',         authRoutes);
app.use('/api/v1/medications',  medicationsRoutes);
app.use('/api/v1/pharmacies',   pharmaciesRoutes);
app.use('/api/v1/reservations', reservationsRoutes);
app.use('/api/v1/payments',     paymentsRoutes);
app.use('/api/v1/admin',        adminRoutes);

// ─── Static web app ───────────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, 'public')));

app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ─── Error handling ───────────────────────────────────────────────────────────
app.use(notFound);
app.use(errorHandler);

// ─── Startup ──────────────────────────────────────────────────────────────────
// On lie le port EN PREMIER pour que le health check Render passe et que le
// service soit "Live", même si la base est momentanément injoignable.
// L'init de la base se fait ensuite, sans jamais tuer le process.
function start() {
  app.listen(PORT, () => {
    console.log(`\n🚀 Medoq API démarrée sur http://localhost:${PORT}`);
    console.log(`🏥 Environment: ${process.env.NODE_ENV || 'development'}\n`);
    initDatabase();
  });
}

async function initDatabase() {
  try {
    const pool = require('./src/database/db');

    // Initialize schema (idempotent)
    await pool.initDb();

    // Auto-seed only if completely empty (never wipe existing data)
    const { rows } = await pool.query('SELECT COUNT(*) as cnt FROM users');
    const userCount = parseInt(rows[0].cnt);

    if (userCount === 0) {
      console.log('📦 Seeding initial data...');
      const seed = require('./src/database/seed');
      await seed().catch(err => console.error('Seed error:', err.message));
    } else {
      const { rows: pRows } = await pool.query('SELECT COUNT(*) as cnt FROM pharmacies');
      console.log(`OK — ${userCount} users, ${parseInt(pRows[0].cnt)} pharmacies`);
    }
  } catch (err) {
    // On NE tue PAS le process : le serveur reste en ligne, la base sera
    // réessayée à la prochaine requête. On loggue l'erreur complète.
    console.error('DB init error (le serveur reste en ligne):', err && (err.stack || err.message || err));
  }
}

start();

module.exports = app;
