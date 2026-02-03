const { detectLanguage } = require('../utils/detectLanguage');

const MAX_CHARS = 2_000_000;

function mapSeverity(s) {
  const v = String(s || '').toLowerCase();
  if (v === 'error' || v === 'high' || v === 'critical') return 'high';
  if (v === 'warning' || v === 'warn' || v === 'medium') return 'medium';
  if (v === 'low') return 'low';
  return 'info';
}

function summarize(findings) {
  return findings.reduce((acc, f) => {
    acc.total += 1;
    acc.byCategory[f.category] = (acc.byCategory[f.category] || 0) + 1;
    acc.bySeverity[f.severity] = (acc.bySeverity[f.severity] || 0) + 1;
    return acc;
  }, { total: 0, byCategory: {}, bySeverity: {} });
}
