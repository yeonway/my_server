// config/security.js
const helmet = require('helmet');
const cors = require('cors');

function buildCors() {
  const raw = process.env.CORS_ORIGINS || 'http://localhost:3000';
  const list = raw.split(',').map(s => s.trim()).filter(Boolean);
  return cors({
    origin: (origin, cb) => {
      if (!origin) return cb(null, true); // 모바일앱/서버 간 통신 등
      if (list.includes(origin)) return cb(null, true);
      return cb(new Error('CORS 차단: ' + origin));
    },
    credentials: true,
    allowedHeaders: ['Content-Type', 'Authorization'],
    methods: ['GET','POST','PUT','DELETE','OPTIONS']
  });
}

function securityMiddleware(app) {
  app.use(helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" }
  }));
  app.use(buildCors());
}

module.exports = { securityMiddleware };