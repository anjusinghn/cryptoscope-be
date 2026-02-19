const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const { detectLanguage } = require('../utils/detectLanguage');
const log = require('../utils/logger');

const ALLOWED = new Set(['javascript', 'typescript', 'java', 'c', 'cpp']);
const MAX_CHARS = 2_000_000; // 2MB safeguard

function langToExt(lang) {
  switch (lang) {
    case 'javascript': return '.js';
    case 'typescript': return '.ts';
    case 'java': return '.java';
    case 'c': return '.c';
    case 'cpp': return '.cpp';
    default: return '.txt';
  }
}

function mapSeverity(s) {
  const v = String(s || '').toUpperCase();
  if (v === 'ERROR' || v === 'HIGH' || v === 'CRITICAL') return 'high';
  if (v === 'WARNING' || v === 'MEDIUM') return 'medium';
  if (v === 'LOW') return 'low';
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

function transformSemgrep(json, filename, language, code) {
  const out = [];
  const results = Array.isArray(json?.results) ? json.results : [];
  for (const r of results) {
    const line = r?.start?.line || r?.extra?.start?.line || 1;
    const column = r?.start?.col || r?.extra?.start?.col || 1;
    const msg = r?.extra?.message || '';
    const sev = mapSeverity(r?.extra?.severity || r?.severity);
    const meta = r?.extra?.metadata || {};
    const category = meta.category || 'rule';
    const recommendation = meta.recommendation || undefined;
    const lines = (r?.extra?.lines || '').trim();
    const match = lines ? (lines.split('\n')[0].slice(0, 200)) : (msg || r?.check_id || 'match');
    out.push({
      line,
      column,
      match,
      ruleId: r?.check_id || 'semgrep.rule',
      category,
      severity: sev,
      description: msg || r?.check_id || 'Semgrep finding',
      recommendation,
    });
  }
  const summary = summarize(out);
  return {
    filename,
    language,
    summary,
    findings: out,
    lines: String(code).split(/\r?\n/).length,
    truncated: String(code).length > MAX_CHARS,
    generatedAt: new Date().toISOString(),
  };
}

let PY_SITE_PACKAGES = null;

function resolvePythonSitePackages() {
  if (PY_SITE_PACKAGES) return PY_SITE_PACKAGES;
  const pythonCandidates = [process.env.PYTHON || 'python3', 'python'];
  for (const py of pythonCandidates) {
    try {
      const out = spawnSync(py, ['-c', 'import sysconfig, site, json; paths = [sysconfig.get_paths()["purelib"], getattr(site, "getusersitepackages", lambda: "")()]; print("\n".join([p for p in paths if p]))'], { encoding: 'utf8' });
      if (out && out.status === 0 && typeof out.stdout === 'string') {
        const lines = out.stdout.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
        if (lines.length) {
          PY_SITE_PACKAGES = lines;
          return PY_SITE_PACKAGES;
        }
      }
    } catch (err) {
      // ignore and continue to next candidate
