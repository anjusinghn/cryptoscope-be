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
      { id: 'manual.java.hash.sha2', re: /\bMessageDigest\.getInstance\(\s*['\"]SHA-?(?:224|256|384|512)['\"]\s*\)/i, category: 'hash', severity: 'info', msg: 'SHA-2 usage' },
      { id: 'manual.java.mac.sha1', re: /\bMac\.getInstance\(\s*['\"]HmacSHA?1['\"]\s*\)/i, category: 'mac', severity: 'high', msg: 'HMAC-SHA1 detected' },
      { id: 'manual.java.cipher.any', re: /\bCipher\.getInstance\s*\(/, category: 'cipher', severity: 'info', msg: 'Cipher.getInstance usage' },
      { id: 'manual.java.mode.ecb', re: /\bCipher\.getInstance\(\s*['\"]AES\/ECB\//i, category: 'mode', severity: 'high', msg: 'AES-ECB detected' },
      { id: 'manual.java.mode.cbc', re: /\bCipher\.getInstance\(\s*['\"]AES\/CBC\//i, category: 'mode', severity: 'warning', msg: 'AES-CBC detected' },
      { id: 'manual.java.mode.gcm', re: /\bCipher\.getInstance\(\s*['\"]AES\/GCM\//i, category: 'mode', severity: 'info', msg: 'AES-GCM usage' },
      { id: 'manual.java.mode.unspecified', re: /\bCipher\.getInstance\(\s*['\"]AES['\"]\s*\)/, category: 'mode', severity: 'warning', msg: 'AES without explicit mode (likely ECB)' },
      { id: 'manual.java.iv.zero', re: /new\s+IvParameterSpec\(\s*new\s+byte\s*\[/, category: 'mode', severity: 'high', msg: 'Zero-initialized IV detected' },
      { id: 'manual.java.random.insecure', re: /\bnew\s+java?\.util\.Random\s*\(/, category: 'random', severity: 'high', msg: 'java.util.Random (not CSPRNG)' },
      { id: 'manual.java.securerandom', re: /\bnew\s+java?\.security\.SecureRandom\s*\(/, category: 'random', severity: 'info', msg: 'SecureRandom usage' },
      { id: 'manual.java.kdf.pbkdf2.sha1', re: /\bSecretKeyFactory\.getInstance\(\s*['\"]PBKDF2WithHmacSHA1['\"]\s*\)/, category: 'kdf', severity: 'warning', msg: 'PBKDF2-HmacSHA1 detected' },
      { id: 'manual.java.kdf.pbkdf2.sha256', re: /\bSecretKeyFactory\.getInstance\(\s*['\"]PBKDF2WithHmacSHA256['\"]\s*\)/, category: 'kdf', severity: 'info', msg: 'PBKDF2-HmacSHA256 usage' },
      { id: 'manual.java.kdf.iter.low', re: /\bnew\s+PBEKeySpec\s*\([^,]+,[^,]+,\s*(\d{1,6})\s*,/m, category: 'kdf', severity: 'warning', msg: 'PBKDF2 iterations may be low' },
    );
  }
  if (lang === 'c' || lang === 'cpp') {
    P.push(
      { id: 'manual.c.openssl.md5', re: /\bEVP_md5\s*\(/, category: 'hash', severity: 'high', msg: 'OpenSSL MD5 detected' },
      { id: 'manual.c.openssl.sha1', re: /\bEVP_sha1\s*\(/, category: 'hash', severity: 'high', msg: 'OpenSSL SHA1 detected' },
      { id: 'manual.c.aes.ecb', re: /\bAES_[A-Za-z0-9_]*ecb[A-Za-z0-9_]*\s*\(/i, category: 'mode', severity: 'high', msg: 'AES-ECB detected' },
      { id: 'manual.c.aes.ecb2', re: /\bEVP_aes_\d+_ecb\b/i, category: 'mode', severity: 'high', msg: 'AES-ECB detected' },
    );
  }
  return P;
}

function scanManual(code, filename = 'snippet') {
  const truncated = String(code).length > MAX_CHARS ? String(code).slice(0, MAX_CHARS) : String(code);
  const language = detectLanguage(filename, truncated);
  const pats = patternsFor(language);
  const findings = [];
  const lines = String(truncated).split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (const p of pats) {
      const m = p.re.exec(line);
      if (m) {
        findings.push({
          line: i + 1,
          column: (m.index || 0) + 1,
