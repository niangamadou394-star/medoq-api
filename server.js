require('dotenv').config();
const express = require('express');
const cors    = require('cors');

// ─── Auto-seed if DB is empty ─────────────────────────────────────────────────
try {
  const db = require('./src/database/db');
  const userCount = db.prepare('SELECT COUNT(*) as cnt FROM users').get().cnt;
  if (userCount === 0) {
    console.log('📦 Base vide — seeding...');
    require('./src/database/seed');
  } else {
    console.log(`✅ Base OK — ${userCount} utilisateur(s)`);
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

app.get('/', (req, res) => {
  res.json({
    service: '💊 Medoq API',
    version: '1.0.0',
    docs: '/health',
    endpoints: [
      'POST   /api/v1/auth/register',
      'POST   /api/v1/auth/login',
      'POST   /api/v1/auth/refresh',
      'POST   /api/v1/auth/logout',
      'GET    /api/v1/auth/me',
      'GET    /api/v1/medications',
      'GET    /api/v1/medications/popular',
      'GET    /api/v1/medications/categories',
      'GET    /api/v1/medications/:id',
      'GET    /api/v1/pharmacies/nearby?lat=&lng=',
      'GET    /api/v1/pharmacies',
      'GET    /api/v1/pharmacies/:id',
      'GET    /api/v1/pharmacies/:id/stock',
      'PUT    /api/v1/pharmacies/:id/stock/:medicationId',
      'POST   /api/v1/reservations',
      'GET    /api/v1/reservations',
      'GET    /api/v1/reservations/pharmacy',
      'POST   /api/v1/reservations/:id/cancel',
      'POST   /api/v1/reservations/:id/ready',
      'POST   /api/v1/reservations/:id/complete',
      'POST   /api/v1/payments/initiate',
      'GET    /api/v1/payments/reservation/:reservationId',
    ]
  });
});

// ─── API Routes ───────────────────────────────────────────────────────────────
app.use('/api/v1/auth',         authRoutes);
app.use('/api/v1/medications',  medicationsRoutes);
app.use('/api/v1/pharmacies',   pharmaciesRoutes);
app.use('/api/v1/reservations', reservationsRoutes);
app.use('/api/v1/payments',     paymentsRoutes);

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
