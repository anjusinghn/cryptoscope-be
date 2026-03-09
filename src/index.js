require('dotenv').config();
const express = require('express');
const { PORT, DEFAULT_CONCURRENCY, MAX_SCAN_FILES, cors, corsOptions, INDEXING_DISABLED } = require('./config');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const multer = require('multer');
const extract = require('extract-zip');
const { spawnSync } = require('child_process');

const log = require('./utils/logger');
const { scanCode } = require('./scanner');
const { cloneGithub, parseGithubUrl, registerWorkspace, getRepoMeta } = require('./repo/github');
const { buildFileArtifacts } = require('./service/artifacts');
const { scanWorkspace, getCachedScan } = require('./service/pipeline');
const { enrichFindingsInMemory, enrichFindingsForVersion } = require('./llm/enrich');
const { classifyFindingsWithGroq, generateReportWithGroq } = require('./llm/groq');
const { initDb, loadScanResult } = require('./db');
const { searchChunks: searchChunksLance } = require('./db/lance');
const { embedTexts } = require('./utils/embed');
const { heuristicEnrichment } = require('./llm/enrich');

const app = express();

// Config --------------------------------------------------------------

app.use(cors(corsOptions));
app.use(express.json({ limit: '5mb' }));

// Routers -------------------------------------------------------------
const healthRouter = require('./routes/health');
const llmRouter = require('./routes/llm');
const scanRouter = require('./routes/scan');
const analyzeRouter = require('./routes/analyze');
const repoRouter = require('./routes/repo');
const filesRouter = require('./routes/files');
const uploadRouter = require('./routes/upload');

app.use(healthRouter);
app.use(llmRouter);
app.use(scanRouter);
app.use(analyzeRouter);
app.use(repoRouter);
app.use(filesRouter);
app.use(uploadRouter);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: Number(process.env.ZIP_MAX_BYTES || 80 * 1024 * 1024),
  },
});

initDb().catch((err) => {
  log.error('database initialization error', { error: String(err?.message || err) });
});

const HEALTH_PAYLOAD = Object.freeze({ ok: true, service: 'cryptoscope-be', version: '0.2.0' });

const SUPPORTED_EXT = new Set([
  '.js', '.mjs', '.cjs', '.ts', '.tsx', '.c', '.cc', '.cpp', '.hpp', '.h', '.java', '.py', '.rb', '.go', '.rs', '.swift', '.cs', '.php', '.kt', '.scala', '.m', '.mm', '.sol', '.rs', '.rb', '.pl', '.sh', '.lua', '.json', '.yml', '.yaml', '.toml', '.ini', '.cfg', '.txt', '.md', '.lock', '.gradle', '.pom', '.xml', '.groovy', '.coffee', '.dart'
]);

const SKIP_DIRS = new Set(['.git', 'node_modules', 'build', 'dist', 'out', 'target', '.next', '.turbo', '.cache']);

// Helpers -------------------------------------------------------------
function posixPath(p) {
  return p.split(path.sep).join('/');
}

async function safeStat(p) {
  try {
    return await fs.promises.stat(p);
  } catch (err) {
    return null;
  }
}

async function collectWorkspaceFiles(root) {
  const queue = [root];
  const results = [];
  const visited = new Set();
  const rootReal = await fs.promises.realpath(root).catch(() => root);
  while (queue.length) {
    const current = queue.pop();
    let entries;
    try {
      entries = await fs.promises.readdir(current, { withFileTypes: true });
    } catch (err) {
      log.warn('collectWorkspaceFiles readdir failed', { path: current, error: String(err?.message || err) });
      continue;
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.git') && entry.isDirectory()) continue;
      const abs = path.join(current, entry.name);
      const rel = posixPath(path.relative(root, abs));
      if (visited.has(abs)) continue;
      visited.add(abs);
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        queue.push(abs);
        continue;
      }
      if (!entry.isFile()) continue;
      const ext = path.extname(entry.name).toLowerCase();
      if (!SUPPORTED_EXT.has(ext)) continue;
      const canonicalRel = rel || entry.name;
      results.push({
        path: canonicalRel,
        absolutePath: abs,
        content: async () => {
          const data = await fs.promises.readFile(abs, 'utf8');
          return data;
        },
      });
      if (results.length >= MAX_SCAN_FILES) {
        log.warn('collectWorkspaceFiles limit reached', { max: MAX_SCAN_FILES, root: rootReal });
        return results;
      }
    }
  }
  return results;
}

async function describeDirectory(root) {
  const out = [];
  async function walk(dir, level) {
    let entries;
    try {
      entries = await fs.promises.readdir(dir, { withFileTypes: true });
    } catch (err) {
      log.warn('describeDirectory failed', { dir, error: String(err?.message || err) });
      return;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const abs = path.join(dir, entry.name);
      const rel = posixPath(path.relative(root, abs)) || entry.name;
      if (entry.isDirectory()) {
        const supported = !SKIP_DIRS.has(entry.name);
        out.push({ type: 'folder', name: entry.name, path: rel, level, supported });
        if (supported) await walk(abs, level + 1);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        out.push({ type: 'file', name: entry.name, path: rel, level, supported: SUPPORTED_EXT.has(ext) });
      }
    }
  }
  await walk(root, 0);
  return out;
}

function sanitizeFinding(f) {
  return {
    id: f.id,
    line: f.line,
    column: f.column,
    match: f.match,
    ruleId: f.ruleId,
    category: f.category,
    severity: f.severity,
    description: f.description,
    recommendation: f.recommendation,
    chunkId: f.chunkId,
    enrichment: f.enrichment || null,
  };
}

function sanitizeFile(file) {
  return {
    path: file.path,
    language: file.language,
    size: file.size,
    summary: file.summary,
    findings: Array.isArray(file.findings) ? file.findings.map(sanitizeFinding) : [],
    chunks: Array.isArray(file.chunks)
      ? file.chunks.map((chunk) => ({
          index: chunk.index,
          startLine: chunk.startLine,
          endLine: chunk.endLine,
          label: chunk.label,
        }))
      : [],
  };
}

function buildRepoPayload({ scan, repoMeta, root, cached }) {
  const summary = scan.summary || scan.version?.summary || { total: 0, byCategory: {}, bySeverity: {} };
  const files = Array.isArray(scan.files) ? scan.files.map(sanitizeFile) : [];
  return {
    repo: {
      id: repoMeta?.id || null,
      url: repoMeta?.url || null,
      owner: repoMeta?.owner || null,
      repo: repoMeta?.repo || null,
      ref: repoMeta?.ref || null,
      subpath: repoMeta?.subpath || null,
      commit: repoMeta?.commit || null,
      versionId: repoMeta?.versionId || scan.versionId || null,
    },
    root,
    files,
    filesScanned: files.length,
    summary,
    generatedAt: scan.version?.updated_at || new Date().toISOString(),
    cached: Boolean(cached),
  };
}

function uniqueList(items) {
  return Array.from(new Set((items || []).map((v) => (typeof v === 'string' ? v.trim() : '')).filter(Boolean)));
}

function buildBasicAnalysis(file) {
  const analysis = {
    file_path: file.path,
    file_name: path.basename(file.path),
    file_extension: path.extname(file.path).replace(/^\./, ''),
    has_crypto: false,
    crypto_imports: [],
    crypto_functions: [],
    crypto_patterns_found: [],
    crypto_algorithms_detected: [],
    code_snippets: [],
  };

  const imports = new Set();
  const patterns = new Set();
  const functions = [];
  const algorithms = [];
  const snippets = [];

  (file.findings || []).forEach((finding, idx) => {
    const snippet = typeof finding.match === 'string' ? finding.match : JSON.stringify(finding.match || '');
    const name = finding.ruleId || finding.category || `Finding ${idx + 1}`;
    if (snippet) {
      const lines = snippet.split(/\r?\n/);
      const importLine = lines.find((line) => /(^\s*import\s+)|(^\s*from\s+.+\s+import\s+)|require\s*\(|#include\s+/.test(line));
      if (importLine) imports.add(importLine.trim());
      snippets.push({ name, line_start: finding.line || null, code: snippet, type: finding.category });
    }
