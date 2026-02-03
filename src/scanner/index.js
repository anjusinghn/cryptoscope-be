const { scanManual } = require('./manual');
let semgrepScan = null;
try { semgrepScan = require('./semgrep').scanWithSemgrep; } catch {}

function chooseProvider() {
  const p = (process.env.SCANNER || '').toLowerCase();
  if (p === 'manual' || !semgrepScan) return 'manual';
  if (p === 'semgrep') return 'semgrep';
  // default to semgrep when available
  return 'semgrep';
