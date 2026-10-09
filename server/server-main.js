import 'dotenv/config';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import cookieParser from 'cookie-parser';
import morgan from 'morgan';
import cors from 'cors';
import helmet from 'helmet';
import { db, initDb } from './db.js';
import { publicRouter } from './routes/public.js';
import { adminRouter } from './routes/admin.js';
import { uploadRouter } from './upload.js';
import { crmRouter } from './routes/crm.js';
import { crmOperationsRouter } from './routes/crm-operations.js';
import { crmFinanceRouter } from './routes/crm-finance.js';
import { staffRouter } from './routes/staff.js';
import { posRouter } from './routes/pos.js';
import { promoRouter } from './routes/promo.js';
import { loyaltyRouter } from './routes/loyalty.js';
import { wheelRouter } from './routes/wheel.js';
import { archiveOldDeliveredOrders, scheduleArchiving } from './cleanup-delivered-orders.js';
import { scheduleReviewMonthlyDraw } from './utils/schedule-review-monthly-draw.js';
import { startAutoNotifyRetryWorker } from './utils/auto-notify-retry.js';
import { startReferralWelcomeNotificationWorker } from './utils/referral-welcome-notify.js';
import { startInternalNotificationWorker } from './utils/internal-notification-worker.js';
import { startSalaryReminderScheduler } from './utils/salary-reminder-scheduler.js';
import { startStaffShiftScheduler } from './utils/staff-service.js';
import { DEV_BACKEND_PORT, PROD_BACKEND_PORT } from '../shared/runtime-ports.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const isProduction = String(process.env.NODE_ENV || '').toLowerCase() === 'production';
const PORT = process.env.PORT || (isProduction ? PROD_BACKEND_PORT : DEV_BACKEND_PORT);
app.set('trust proxy', 1);

function parseAllowedCorsOrigins() {
  const configured = String(process.env.CORS_ORIGINS || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  if (configured.length) return configured;

  if (process.env.BASE_URL) {
    try {
      return [new URL(process.env.BASE_URL).origin];
    } catch (error) {
      console.warn('[cors] Invalid BASE_URL, no production CORS origin configured');
    }
  }
  return [];
}

function buildCorsOptions() {
  if (process.env.NODE_ENV !== 'production') {
    return { origin: true, credentials: true };
  }
  const allowedOrigins = parseAllowedCorsOrigins();
  return {
    credentials: true,
    origin(origin, callback) {
      if (!origin) return callback(null, true);
      if (allowedOrigins.includes(origin)) return callback(null, true);
      return callback(null, false);
    },
  };
}

function sanitizeRequestUrl(originalUrl = '') {
  if (!originalUrl || !originalUrl.includes('?')) {
    return originalUrl;
  }

  const [pathname, queryString] = originalUrl.split('?', 2);
  const params = new URLSearchParams(queryString);
  ['telegram_id', 'telegram_username'].forEach((key) => {
    if (params.has(key)) {
      params.set(key, '[redacted]');
    }
  });
  const sanitizedQuery = params.toString();
  return sanitizedQuery ? `${pathname}?${sanitizedQuery}` : pathname;
}

morgan.token('safe-url', (req) => sanitizeRequestUrl(req.originalUrl || req.url || ''));

// Init DB (tables + seed)
initDb();

// Архивация старых выданных заказов при старте
archiveOldDeliveredOrders();

// Планируем ежедневную архивацию в полночь
scheduleArchiving();

// Авто-розыгрыш отзывов: последний день месяца в 21:00 по Минску
scheduleReviewMonthlyDraw();

// Повтор авто-уведомлений при временной недоступности userbot
startAutoNotifyRetryWorker();
startReferralWelcomeNotificationWorker();
startInternalNotificationWorker(db);
startSalaryReminderScheduler(db);
startStaffShiftScheduler();

// Middlewares
app.use(morgan(':method :safe-url :status :response-time ms - :res[content-length]'));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(cors(buildCorsOptions()));
app.use(helmet({ contentSecurityPolicy: false }));

// Defense in depth: API and uploaded files must not appear in search results.
app.use((req, res, next) => {
  res.setHeader(
    'X-Robots-Tag',
    'noindex, nofollow, noarchive, nosnippet, noimageindex',
  );
  next();
});


// Static (БЕЗ КЭША)
const uploadsDir = path.resolve(__dirname, '../uploads');
app.use('/uploads', express.static(uploadsDir, { 
  maxAge: 0,
  etag: false,
  lastModified: false,
  setHeaders: (res) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.setHeader('X-Content-Type-Options', 'nosniff');
  }
}));

// Health
app.get('/api/health', (req, res) => {
  res.json({ ok: true, uptime: process.uptime() });
});

// Public API
app.use(publicRouter);
// Admin API
app.use(adminRouter);
// Upload API
app.use(uploadRouter);
// CRM API
app.use(crmRouter);
app.use(crmOperationsRouter);
app.use(crmFinanceRouter);
app.use(staffRouter);
// POS API
app.use(posRouter);
// Promo API
app.use(promoRouter);
// Loyalty API
app.use(loyaltyRouter);
// Wheel API
app.use(wheelRouter);


app.listen(PORT, () => {
  console.log(`[navalivay] server listening on :${PORT}`);
});
