require('dotenv').config();
const cors = require('cors');
const log = require('./utils/logger');

// Global configuration and shared CORS options
const PORT = Number(process.env.PORT || 5050);
const MAX_SCAN_FILES = Number(process.env.SCAN_MAX_FILES || 2000);
const DEFAULT_CONCURRENCY = Number(process.env.SCAN_CONCURRENCY || 4);
const enableIndexingEnv = String(process.env.ENABLE_INDEXING || '').trim().toLowerCase();
const disableIndexingEnv = String(process.env.DISABLE_INDEXING || process.env.SKIP_INDEXING || '').trim().toLowerCase();
let INDEXING_DISABLED = true;
if (enableIndexingEnv === '1' || enableIndexingEnv === 'true' || enableIndexingEnv === 'yes') {
  INDEXING_DISABLED = false;
} else if (disableIndexingEnv.length) {
  INDEXING_DISABLED = disableIndexingEnv === '1' || disableIndexingEnv === 'true' || disableIndexingEnv === 'yes';
}

const ALLOWED_ORIGINS = (process.env.CORS_ORIGINS || 'http://localhost:3000,http://127.0.0.1:3000')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

const corsOptions = {
  credentials: true,
  origin: (origin, callback) => {
    // Allow requests without Origin (like curl) and same-origin
    if (!origin) {
      log.info('cors origin check', { origin: null, allowed: true });
      return callback(null, true);
    }
    const allowed = ALLOWED_ORIGINS.includes('*') || ALLOWED_ORIGINS.includes(origin);
    log.info('cors origin check', { origin, allowed, allowedOrigins: ALLOWED_ORIGINS });
    if (allowed) return callback(null, true);
    // Do not error out. Let route handlers decide their own CORS headers (e.g., SSE sets its own).
    return callback(null, false);
  },
  optionsSuccessStatus: 204,
};

module.exports = {
  PORT,
  MAX_SCAN_FILES,
  DEFAULT_CONCURRENCY,
  ALLOWED_ORIGINS,
  INDEXING_DISABLED,
  cors,
  corsOptions,
};
