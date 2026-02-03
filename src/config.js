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
