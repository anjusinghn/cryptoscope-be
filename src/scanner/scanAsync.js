const { scanManualAsync } = require('./manual');
let semgrepAsync = null;
try { semgrepAsync = require('./semgrep').scanWithSemgrepAsync; } catch {}

function chooseProvider() {
  const p = (process.env.SCANNER || '').toLowerCase();
  if (p === 'manual' || !semgrepAsync) return 'manual';
  if (p === 'semgrep') return 'semgrep';
  return 'semgrep';
}

async function scanCodeAsync(code, filename = 'snippet') {
  const provider = chooseProvider();
  if (provider === 'semgrep' && semgrepAsync) return await semgrepAsync(code, filename);
  return await scanManualAsync(code, filename);
}

module.exports = { scanCodeAsync };
