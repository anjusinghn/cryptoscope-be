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

function patternsFor(lang) {
  const P = [];
  if (lang === 'javascript' || lang === 'typescript') {
    P.push(
      { id: 'manual.js.hash.md5', re: /\bcreateHash\(\s*['\"]md5['\"]\s*\)/i, category: 'hash', severity: 'high', msg: 'MD5 detected' },
      { id: 'manual.js.hash.sha1', re: /\bcreateHash\(\s*['\"]sha-?1['\"]\s*\)/i, category: 'hash', severity: 'high', msg: 'SHA-1 detected' },
      { id: 'manual.js.hmac.sha1', re: /\bcreateHmac\(\s*['\"]sha-?1['\"]\s*,/i, category: 'mac', severity: 'high', msg: 'HMAC-SHA1 detected' },
      { id: 'manual.js.mode.ecb', re: /\bcreate(?:Cipher|Decipher)iv\(\s*['\"][^'\"]*ecb[^'\"]*['\"]/i, category: 'mode', severity: 'high', msg: 'AES-ECB detected' },
      { id: 'manual.js.mode.cbc', re: /\bcreate(?:Cipher|Decipher)iv\(\s*['\"][^'\"]*cbc[^'\"]*['\"]/i, category: 'mode', severity: 'warning', msg: 'AES-CBC detected' },
      { id: 'manual.js.mode.gcm', re: /\bcreate(?:Cipher|Decipher)iv\(\s*['\"][^'\"]*gcm[^'\"]*['\"]/i, category: 'mode', severity: 'info', msg: 'AES-GCM usage' },
      { id: 'manual.js.random.math', re: /\bMath\.random\s*\(/, category: 'random', severity: 'high', msg: 'Math.random is not CSPRNG' },
      { id: 'manual.js.random.bytes', re: /\bcrypto\.randomBytes\s*\(/, category: 'random', severity: 'info', msg: 'crypto.randomBytes usage' },
      { id: 'manual.js.kdf.pbkdf2', re: /\bpbkdf2(?:Sync)?\s*\(/, category: 'kdf', severity: 'info', msg: 'PBKDF2 usage' },
    );
  }
  if (lang === 'java') {
    P.push(
      { id: 'manual.java.hash.md5', re: /\bMessageDigest\.getInstance\(\s*['\"]MD5['\"]\s*\)/, category: 'hash', severity: 'high', msg: 'MD5 detected' },
      { id: 'manual.java.hash.sha1', re: /\bMessageDigest\.getInstance\(\s*['\"]SHA-?1['\"]\s*\)/i, category: 'hash', severity: 'high', msg: 'SHA-1 detected' },
