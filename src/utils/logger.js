const enabled = String(process.env.CRYPTOSCOPE_DEBUG || '').toLowerCase() === '1' ||
  String(process.env.LOG_LEVEL || '').toLowerCase() === 'debug';

function ts() {
  try { return new Date().toISOString(); } catch { return '';
  }
}

function safe(obj) {
  if (obj == null) return '';
  try { return JSON.stringify(obj); } catch { try { return String(obj); } catch { return '[unprintable]'; } }
}

function debug(msg, meta) {
  if (!enabled) return;
  if (meta !== undefined) console.log(`[${ts()}] [debug] ${msg} ${safe(meta)}`);
  else console.log(`[${ts()}] [debug] ${msg}`);
}

function info(msg, meta) {
  if (meta !== undefined) console.log(`[${ts()}] [info ] ${msg} ${safe(meta)}`);
  else console.log(`[${ts()}] [info ] ${msg}`);
}

function warn(msg, meta) {
  if (meta !== undefined) console.warn(`[${ts()}] [warn ] ${msg} ${safe(meta)}`);
  else console.warn(`[${ts()}] [warn ] ${msg}`);
}

function error(msg, meta) {
  if (meta !== undefined) console.error(`[${ts()}] [error] ${msg} ${safe(meta)}`);
  else console.error(`[${ts()}] [error] ${msg}`);
}

module.exports = { debug, info, warn, error };

