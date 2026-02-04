const { scanManualAsync } = require('./manual');
let semgrepAsync = null;
try { semgrepAsync = require('./semgrep').scanWithSemgrepAsync; } catch {}

function chooseProvider() {
  const p = (process.env.SCANNER || '').toLowerCase();
  if (p === 'manual' || !semgrepAsync) return 'manual';
  if (p === 'semgrep') return 'semgrep';
  return 'semgrep';
