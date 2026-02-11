const { loadScanResult, searchChunksByVector, toVectorLiteral, updateFindingsEnrichment } = require('../db');
const { searchChunks: searchChunksLance } = require('../db/lance');
const { embedTexts } = require('../utils/embed');
const log = require('../utils/logger');

const DEFAULT_BATCH = Number(process.env.ENRICHMENT_BATCH || 8);

function heuristicEnrichment(finding) {
  const out = {
    primitive: 'unknown',
    algorithm: 'unknown',
    mode: 'unknown',
    key_size: 'unknown',
    iv_usage: 'unknown',
    salt_usage: 'unknown',
    risk_summary: finding.description || finding.ruleId || 'Crypto usage detected',
  };
  const rule = String(finding.ruleId || '').toLowerCase();
  const desc = String(finding.description || '').toLowerCase();
  const match = String(finding.match || '').toLowerCase();
  const category = String(finding.category || '').toLowerCase();

  if (category === 'hash' || /hash/.test(rule)) out.primitive = 'hash';
  if (category === 'mode' || /aes|cipher/.test(rule)) out.primitive = 'cipher';
  if (category === 'random') out.primitive = 'rng';
  if (category === 'mac' || /hmac/.test(rule)) out.primitive = 'mac';
  if (category === 'kdf' || /pbkdf|scrypt|bcrypt/.test(rule)) out.primitive = 'kdf';

  const algorithmMatch = (match || desc).match(/(md5|sha[-\s]?1|sha[-\s]?256|sha[-\s]?512|pbkdf2|scrypt|aes[-\s]?(?:128|192|256)?|rsa|ecdh|ecdsa|chacha20|gcm|cbc|ecb)/i);
  if (algorithmMatch) {
    const algo = algorithmMatch[1].toLowerCase();
    if (/gcm|cbc|ecb/.test(algo)) {
      out.mode = algo.toUpperCase();
      out.primitive = 'cipher';
    } else {
      out.algorithm = algo.toUpperCase();
    }
  }

  if (/aes[-\s]?256|256/.test(match)) out.key_size = '256';
  else if (/aes[-\s]?192|192/.test(match)) out.key_size = '192';
  else if (/aes[-\s]?128|128/.test(match)) out.key_size = '128';

