const express = require('express');

const router = express.Router();

// A small helper to read version from package.json without crashing if missing
let version = '0.2.0';
try {
  // Adjust path from routes/ to project root package.json
  // eslint-disable-next-line import/no-dynamic-require, global-require
  const pkg = require('../../package.json');
  version = pkg.version || version;
} catch {}

const HEALTH_PAYLOAD = Object.freeze({ ok: true, service: 'cryptoscope-be', version });

function sendHealth(_req, res) {
  res.json(HEALTH_PAYLOAD);
}

router.get('/healthz', sendHealth);
router.get('/api/healthz', sendHealth);
router.get('/health', sendHealth);
router.get('/api/health', sendHealth);

module.exports = router;
