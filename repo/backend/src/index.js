try { require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env') }); } catch {}
const Koa = require('koa');
const bodyParser = require('koa-bodyparser');
const cors = require('@koa/cors');
const https = require('https');
const http = require('http');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

const { errorHandler } = require('./middleware/errorHandler');
const { startBackupScheduler, stopBackupScheduler } = require('./services/backupScheduler');
const { startDQScheduler, stopDQScheduler } = require('./services/dqScheduler');
const log = require('./utils/logger');

// ─── Create Koa App ─────────────────────────────────────────

const app = new Koa();

// ─── Trust proxy (for correct ctx.ip behind reverse proxies) ─

app.proxy = true;

// ─── Request ID Middleware ──────────────────────────────────

app.use(async (ctx, next) => {
  ctx.state.requestId = ctx.get('X-Request-Id') || uuidv4();
  ctx.set('X-Request-Id', ctx.state.requestId);
  await next();
});

// ─── Global Error Handler ───────────────────────────────────

app.use(errorHandler());

// ─── CORS ───────────────────────────────────────────────────

const CORS_ORIGINS = process.env.CORS_ORIGINS
  ? process.env.CORS_ORIGINS.split(',').map(s => s.trim())
  : ['http://localhost:8443', 'https://localhost:8443'];

app.use(cors({
  origin: (ctx) => {
    const requestOrigin = ctx.get('Origin');
    if (CORS_ORIGINS.includes(requestOrigin)) return requestOrigin;
    return false;
  },
  allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization', 'X-Request-Id'],
  exposeHeaders: ['X-Request-Id'],
  credentials: true,
  maxAge: 86400
}));

// ─── Body Parser ────────────────────────────────────────────

app.use(bodyParser({
  enableTypes: ['json'],
  jsonLimit: '1mb',
  onerror: (err, ctx) => {
    ctx.throw(400, 'Invalid JSON in request body.');
  }
}));

// ─── Request Logger ─────────────────────────────────────────

app.use(async (ctx, next) => {
  const start = Date.now();
  await next();
  const ms = Date.now() - start;
  const level = ctx.status >= 500 ? 'error' : ctx.status >= 400 ? 'warn' : 'info';
  log[level]('http', `${ctx.method} ${ctx.url} ${ctx.status} ${ms}ms`, {
    method: ctx.method, url: ctx.url, status: ctx.status, ms,
    requestId: ctx.state.requestId
  });
});

// ─── Health Check ───────────────────────────────────────────

const Router = require('koa-router');
const healthRouter = new Router();
healthRouter.get('/api/health', async (ctx) => {
  const db = require('./database/connection');
  let dbStatus = 'unknown';
  try {
    await db.raw('SELECT 1');
    dbStatus = 'connected';
  } catch (err) {
    dbStatus = 'disconnected';
  }
  // Report TLS state so acceptance verification can confirm HTTPS is active
  const tlsActive = !!(ctx.req.socket.encrypted || ctx.req.connection.encrypted);
  ctx.body = {
    success: true,
    data: {
      status: 'ok',
      timestamp: new Date().toISOString(),
      database: dbStatus,
      tls: tlsActive ? 'active' : 'inactive',
      uptime: process.uptime()
    }
  };
});
app.use(healthRouter.routes());

// ─── Load Route Modules ─────────────────────────────────────

const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const stationRoutes = require('./routes/stations');
const trainsetRoutes = require('./routes/trainsets');
const tripRoutes = require('./routes/trips');
const scheduleRoutes = require('./routes/schedules');
const approvalRoutes = require('./routes/approvals');
const inventoryRoutes = require('./routes/inventory');
const backupRoutes = require('./routes/backups');
const dataQualityRoutes = require('./routes/dataQuality');
const auditRoutes = require('./routes/audit');

app.use(authRoutes.routes()).use(authRoutes.allowedMethods());
app.use(userRoutes.routes()).use(userRoutes.allowedMethods());
app.use(stationRoutes.routes()).use(stationRoutes.allowedMethods());
app.use(trainsetRoutes.routes()).use(trainsetRoutes.allowedMethods());
app.use(tripRoutes.routes()).use(tripRoutes.allowedMethods());
app.use(scheduleRoutes.routes()).use(scheduleRoutes.allowedMethods());
app.use(approvalRoutes.routes()).use(approvalRoutes.allowedMethods());
app.use(inventoryRoutes.routes()).use(inventoryRoutes.allowedMethods());
app.use(backupRoutes.routes()).use(backupRoutes.allowedMethods());
app.use(dataQualityRoutes.routes()).use(dataQualityRoutes.allowedMethods());
app.use(auditRoutes.routes()).use(auditRoutes.allowedMethods());

// ─── 404 Handler ────────────────────────────────────────────

app.use(async (ctx) => {
  if (!ctx.body) {
    ctx.status = 404;
    ctx.body = {
      success: false,
      error: {
        code: 'NOT_FOUND',
        message: `Route ${ctx.method} ${ctx.url} not found.`
      }
    };
  }
});

// ─── Start Server ───────────────────────────────────────────

const PORT = parseInt(process.env.PORT, 10) || 3443;
const TLS_CERT_PATH = process.env.TLS_CERT_PATH;
const TLS_KEY_PATH = process.env.TLS_KEY_PATH;
const NODE_ENV = process.env.NODE_ENV || 'development';
// TLS is mandatory in all operational modes. HTTP only for isolated test profile.
const SECURITY_MODE = process.env.SECURITY_MODE || (NODE_ENV === 'test' ? 'test' : 'strict');

let server;

// Startup self-check
log.info('server', 'Starting RailOps backend', { securityMode: SECURITY_MODE, nodeEnv: NODE_ENV, tlsCert: TLS_CERT_PATH || '(not set)', tlsKey: TLS_KEY_PATH || '(not set)', port: PORT });

if (TLS_CERT_PATH && TLS_KEY_PATH) {
  try {
    const sslOptions = {
      cert: fs.readFileSync(TLS_CERT_PATH),
      key: fs.readFileSync(TLS_KEY_PATH),
      minVersion: 'TLSv1.2'
    };
    server = https.createServer(sslOptions, app.callback());
    server.listen(PORT, () => {
      log.info('server', `RailOps backend running on HTTPS port ${PORT}`, { transport: 'https', port: PORT });
    });
  } catch (err) {
    log.error('server', `FATAL: Failed to load TLS certificates: ${err.message}`);
    process.exit(1);
  }
} else if (SECURITY_MODE === 'test') {
  log.warn('server', 'No TLS — running HTTP in test-only mode', { transport: 'http', port: PORT });
  server = http.createServer(app.callback());
  server.listen(PORT, () => {
    log.info('server', `RailOps backend running on HTTP port ${PORT} (test mode)`, { transport: 'http', port: PORT });
  });
} else {
  log.error('server', 'FATAL: TLS required. Set TLS_CERT_PATH and TLS_KEY_PATH.');
  process.exit(1);
}

// ─── Start Backup Scheduler ────────────────────────────────

startBackupScheduler().catch(err => {
  log.error('server', `Failed to start backup scheduler: ${err.message}`);
});

startDQScheduler();

// ─── Graceful Shutdown ──────────────────────────────────────

process.on('SIGTERM', () => {
  log.info('server', 'SIGTERM received — shutting down gracefully');
  stopBackupScheduler();
  stopDQScheduler();
  server.close(() => {
    const db = require('./database/connection');
    db.destroy().then(() => {
      log.info('server', 'Database connections closed');
      process.exit(0);
    });
  });
});

process.on('SIGINT', () => {
  log.info('server', 'SIGINT received — shutting down');
  stopBackupScheduler();
  stopDQScheduler();
  server.close(() => {
    const db = require('./database/connection');
    db.destroy().then(() => {
      process.exit(0);
    });
  });
});

module.exports = app;
