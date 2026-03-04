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

  if (/iv/.test(desc) || /iv/.test(match)) {
    if (/buffer\.alloc\s*\(\s*0?\s*\)/.test(match) || /new\s+(?:byte|uint8array)\s*\(/.test(match)) {
      out.iv_usage = 'static-zero';
    } else {
      out.iv_usage = 'present';
    }
  }

  if (/salt/.test(desc) || /salt/.test(match)) out.salt_usage = 'present';

  return out;
}

async function getGroqModel() {
  if (!process.env.GROQ_API_KEY) return null;
  try {
    const { ChatGroq } = await import('@langchain/groq');
    return new ChatGroq({
      apiKey: process.env.GROQ_API_KEY,
      model: process.env.GROQ_ENRICH_MODEL || process.env.GROQ_MODEL || 'llama-3.3-70b-versatile',
      temperature: 0,
    });
  } catch (err) {
    log.warn('failed to init Groq enrich model', { error: String(err?.message || err) });
    return null;
  }
}

function buildPromptItem(finding, context) {
  return {
    ruleId: finding.ruleId,
    category: finding.category,
    severity: finding.severity,
    description: finding.description,
    match: finding.match,
    path: finding.path,
    context,
  };
}

function dedupeChunks(primary, related) {
  const seen = new Set();
  const out = [];
  if (primary) {
    seen.add(primary.id);
    out.push(primary);
  }
  for (const chunk of related || []) {
    if (!chunk || seen.has(chunk.id)) continue;
    seen.add(chunk.id);
    out.push(chunk);
    if (out.length >= 3) break;
  }
  return out;
}

function buildContext(chunks) {
  return chunks
    .map((chunk, idx) => `Context ${idx + 1} (${chunk.label || 'chunk'} lines ${chunk.start_line || chunk.startLine}-${chunk.end_line || chunk.endLine}):\n${chunk.content}`)
    .join('\n\n');
}

async function enrichBatch({ model, versionId, items }) {
  if (!model) return items.map(({ finding }) => ({ finding, enrichment: heuristicEnrichment(finding) }));
  const promptItems = items.map((item, idx) => ({ index: idx, ...buildPromptItem(item.finding, item.context) }));
  const schema = {
    type: 'object',
    properties: {
      items: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            index: { type: 'number' },
            primitive: { type: 'string' },
            algorithm: { type: 'string' },
            mode: { type: 'string' },
            key_size: { type: ['string', 'number'] },
            iv_usage: { type: 'string' },
            salt_usage: { type: 'string' },
            risk_summary: { type: 'string' },
          },
          required: ['index', 'primitive', 'algorithm', 'mode', 'key_size', 'iv_usage', 'salt_usage', 'risk_summary'],
        },
      },
    },
    required: ['items'],
  };
  try {
    const runnable = model.withStructuredOutput(schema);
    const response = await runnable.invoke([
      {
        role: 'system',
        content: 'You are a cryptography security analyst. For each finding, classify the crypto primitive and record algorithm, mode, key size, IV usage, salt usage, and a short risk summary. Use "unknown" when information is not present.',
      },
      {
        role: 'user',
        content: [{ type: 'text', text: `Analyze findings JSON:\n${JSON.stringify(promptItems)}` }],
      },
    ]);
    const map = new Map();
    for (const item of response.items || []) {
      map.set(item.index, {
        primitive: item.primitive || 'unknown',
        algorithm: item.algorithm || 'unknown',
        mode: item.mode || 'unknown',
        key_size: String(item.key_size ?? 'unknown'),
        iv_usage: item.iv_usage || 'unknown',
        salt_usage: item.salt_usage || 'unknown',
        risk_summary: item.risk_summary || 'Crypto usage detected',
      });
    }
    return items.map(({ finding }, idx) => {
      const enriched = map.get(idx);
      return { finding, enrichment: enriched || heuristicEnrichment(finding) };
    });
  } catch (err) {
    log.warn('enrichBatch fallback', { versionId, error: String(err?.message || err) });
    return items.map(({ finding }) => ({ finding, enrichment: heuristicEnrichment(finding) }));
  }
}

async function enrichFindingsForVersion(versionId) {
  log.info('=== STEP 3: ENRICH - Starting LLM enrichment ===', { 
    versionId,
    step: 'ENRICH_START'
  });

  const scan = await loadScanResult(versionId);
