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
    }
  }
  return null;
}

function prepareSemgrepEnv() {
  // Semgrep tries to write logs under ~/.semgrep by default, which may be disallowed.
  // Redirect logs and app data into a workspace-local directory.
  const workspaceRoot = process.cwd();
  const semgrepDir = path.resolve(workspaceRoot, '.semgrep');
  try { fs.mkdirSync(semgrepDir, { recursive: true }); } catch {}
  const localHome = semgrepDir;
  const sitePackages = resolvePythonSitePackages();
  let mergedPythonPath = process.env.PYTHONPATH || '';
  if (Array.isArray(sitePackages)) {
    for (const sp of sitePackages) {
      if (!sp) continue;
      mergedPythonPath = mergedPythonPath ? `${mergedPythonPath}:${sp}` : sp;
    }
  } else if (typeof sitePackages === 'string' && sitePackages) {
    mergedPythonPath = mergedPythonPath ? `${mergedPythonPath}:${sitePackages}` : sitePackages;
  }
  if (!mergedPythonPath) {
    const homedir = os.homedir();
    const fallbacks = [
      path.join(homedir, '.local', 'lib', 'python3.13', 'site-packages'),
      '/usr/lib/python3.13/site-packages',
    ].filter((p) => {
      try { return fs.existsSync(p); } catch { return false; }
    });
    if (fallbacks.length) {
      mergedPythonPath = fallbacks.join(':');
    }
  }
  const env = {
    ...process.env,
    SEMGREP_USER_LOG_FILE: path.join(semgrepDir, 'semgrep.log'),
    SEMGREP_APP_DATA_DIR: semgrepDir,
    SEMGREP_SEND_METRICS: 'off',
    SEMGREP_DISABLE_VERSION_CHECK: '1',
    HOME: localHome,
  };
  if (mergedPythonPath) env.PYTHONPATH = mergedPythonPath;
  // Ensure the temporary HOME exists for semgrep runtime cache/logs
  try { fs.mkdirSync(localHome, { recursive: true }); } catch {}
  return env;
}

let SEMGREP_CMD = null;
function resolveSemgrepCmd(env) {
  if (SEMGREP_CMD) return SEMGREP_CMD;
  const tryCmd = (cmd) => {
    try {
      const p = spawnSync(cmd, ['--version'], { encoding: 'utf8', env });
      // consider any output as viable; semgrep returns version on stdout
      if (p && typeof p.stdout === 'string' && p.stdout.trim().length > 0) return true;
      // Some builds may not support --version; accept if exit code is 0
      if (p && p.status === 0) return true;
    } catch {}
    return false;
  };
  if (tryCmd('semgrep')) { SEMGREP_CMD = 'semgrep'; return SEMGREP_CMD; }
  if (tryCmd('pysemgrep')) { SEMGREP_CMD = 'pysemgrep'; return SEMGREP_CMD; }
  // Fallback to semgrep; caller will surface a helpful error if it fails
  SEMGREP_CMD = 'semgrep';
  return SEMGREP_CMD;
}

function writeTempFile(code, filename, language) {
  const tmpdir = fs.mkdtempSync(path.join(os.tmpdir(), 'cryptoscope-sg-'));
  const base = path.basename(filename || 'snippet' + langToExt(language));
  const hasExt = /\.[A-Za-z0-9]+$/.test(base);
  const file = path.join(tmpdir, hasExt ? base : (base + langToExt(language)));
  fs.writeFileSync(file, code);
  return { tmpdir, file };
}

function runSemgrepSync(targetPath) {
  // Prefer scanning with our rules directory; include all yml under be/semgrep.
  // Resolve relative to this file to avoid cwd issues.
  const cfgPath = path.resolve(__dirname, '..', '..', 'semgrep', 'cryptoscope-java-cpp.yml');
  const args = [
    'scan',
    '--json', '--no-rewrite-rule-ids', '--skip-unknown-extensions',
    '--config', cfgPath,
    targetPath,
  ];
  const started = Date.now();
  
  // Check if config file exists
  try {
    const configExists = fs.existsSync(cfgPath);
    log.info('Semgrep config check', { cfgPath, exists: configExists });
    if (!configExists) {
      log.error('Semgrep config file missing', { cfgPath });
      throw new Error(`Config file not found: ${cfgPath}`);
    }
  } catch (e) {
    log.error('Config file check failed', { cfgPath, error: e.message });
    throw e;
  }

  log.info('Semgrep sync start', { cfgPath, targetPath, args, cmd: 'semgrep' });
  const env = prepareSemgrepEnv();
  const cmd = resolveSemgrepCmd(env);
  
  log.info('Semgrep command resolved', { cmd, env: { SEMGREP_USER_LOG_FILE: env.SEMGREP_USER_LOG_FILE } });
  
  const proc = spawnSync(cmd, args, { encoding: 'utf8', env });
  const dur = Date.now() - started;
  
  log.info('Semgrep execution complete', { 
    code: proc.status, 
    duration_ms: dur, 
    stdout_len: (proc.stdout || '').length, 
    stderr_len: (proc.stderr || '').length,
    cmd,
    args: args.join(' ')
  });
  
  if (proc.stderr) {
    log.warn('Semgrep stderr', { stderr: proc.stderr });
  }
  
  const stdout = proc.stdout || '';
  
  // Log raw output for debugging
  if (stdout) {
    log.info('Semgrep stdout preview', { 
      first_500_chars: stdout.substring(0, 500),
      total_length: stdout.length 
    });
  }
  
  // Semgrep exit code: 0 (no findings), 1 (findings), 2+ (errors). Parse JSON when present.
  try {
    const result = JSON.parse(stdout);
    log.info('Semgrep JSON parsed successfully', { 
      results_count: result?.results?.length || 0,
      errors_count: result?.errors?.length || 0,
      has_results: Boolean(result?.results?.length)
    });
    
    if (result?.results?.length > 0) {
      log.info('Semgrep findings summary', {
        total_findings: result.results.length,
        rule_ids: [...new Set(result.results.map(r => r.check_id))],
        severities: [...new Set(result.results.map(r => r.extra?.severity || 'unknown'))]
      });
    }
    
    return result;
  } catch (e) {
    log.error('Semgrep JSON parse failed', { 
      error: e.message, 
      stdout_preview: stdout.substring(0, 1000),
      stderr: proc.stderr || 'none'
    });
    const err = (proc.stderr || '').trim() || e.message;
    throw new Error('Semgrep failed: ' + err);
  }
}

function runSemgrepAsync(targetPath) {
  return new Promise((resolve, reject) => {
    const cfgPath = path.resolve(__dirname, '..', '..', 'semgrep', 'cryptoscope-java-cpp.yml');
    const args = [
      'scan',
      '--json', '--no-rewrite-rule-ids', '--skip-unknown-extensions',
      '--config', cfgPath,
      targetPath,
    ];
    
    // Check if config file exists
    try {
      const configExists = fs.existsSync(cfgPath);
      log.info('Semgrep async config check', { cfgPath, exists: configExists });
      if (!configExists) {
        log.error('Semgrep async config file missing', { cfgPath });
        reject(new Error(`Config file not found: ${cfgPath}`));
        return;
      }
    } catch (e) {
      log.error('Async config file check failed', { cfgPath, error: e.message });
      reject(e);
      return;
    }
    
    log.info('Starting Semgrep async scan', { file: targetPath, cfgPath, args });
    const t0 = Date.now();
    const env = prepareSemgrepEnv();
    const cmd = resolveSemgrepCmd(env);
    
  log.info('Semgrep async command resolved', {
    cmd,
    env: {
      SEMGREP_USER_LOG_FILE: env.SEMGREP_USER_LOG_FILE,
      HOME: env.HOME,
      PYTHONPATH: env.PYTHONPATH,
    }
  });
    
    const p = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], env });
    let out = '', err = '';
    
    p.stdout.on('data', d => {
      const chunk = d.toString();
      out += chunk;
      log.debug('Semgrep async stdout chunk', { size: chunk.length });
    });
    
    p.stderr.on('data', d => {
      const chunk = d.toString();
      err += chunk;
      log.warn('Semgrep async stderr chunk', { chunk });
    });
    
    p.on('error', (e) => {
      log.error('Semgrep async process error', { error: e.message, cmd, args });
      reject(e);
    });
    
    p.on('close', (code) => {
      const dur = Date.now() - t0;
      log.info('Semgrep async scan finished', { 
        file: targetPath, 
        duration_ms: dur, 
        exit_code: code,
        stdout_len: out.length,
        stderr_len: err.length
      });
      
      if (out) {
        log.info('Semgrep async stdout preview', { 
          first_500_chars: out.substring(0, 500),
          total_length: out.length 
        });
      }
      
      try { 
        const result = JSON.parse(out || '{}');
        log.info('Semgrep async JSON parsed successfully', { 
          results_count: result?.results?.length || 0,
          errors_count: result?.errors?.length || 0,
          has_results: Boolean(result?.results?.length)
        });
        
        if (result?.results?.length > 0) {
          log.info('Semgrep async findings summary', {
            total_findings: result.results.length,
            rule_ids: [...new Set(result.results.map(r => r.check_id))],
            severities: [...new Set(result.results.map(r => r.extra?.severity || 'unknown'))]
          });
        }
        
        resolve(result); 
      }
      catch (e) { 
        log.error('Semgrep async JSON parse failed', { 
          error: e.message, 
          stdout_preview: out.substring(0, 1000),
          stderr: err || 'none'
        });
        reject(new Error('Semgrep failed: ' + (err || e.message))); 
      }
    });
  });
}

function scanWithSemgrep(code, filename = 'snippet') {
  const truncated = String(code).length > MAX_CHARS ? String(code).slice(0, MAX_CHARS) : String(code);
  const language = detectLanguage(filename, truncated);
  
  log.info('scanWithSemgrep start', { 
    filename, 
    language, 
    size: String(truncated).length,
    original_size: String(code).length,
    truncated: String(code).length > MAX_CHARS
  });
  
  if (!ALLOWED.has(language)) {
    log.warn('Language not supported', { filename, language, supported: Array.from(ALLOWED) });
    return {
      filename,
      language,
      summary: { total: 0, byCategory: {}, bySeverity: {} },
      findings: [],
      lines: String(truncated).split(/\r?\n/).length,
      truncated: String(code).length > MAX_CHARS,
      generatedAt: new Date().toISOString(),
      unsupported: true,
      message: 'Language not supported. Supported: JS/TS, C/C++, Java.'
    };
  }
  
  log.info('Creating temporary file for Semgrep scan', { filename, language });
  const { tmpdir, file } = writeTempFile(truncated, filename, language);
  
  log.info('Temporary file created', { tmpdir, file });
  
  try {
    try {
      log.info('Running Semgrep scan on temporary file', { file, filename, language });
      const json = runSemgrepSync(file);
      log.info('Semgrep scan completed, transforming results', { file, filename });
      const res = transformSemgrep(json, filename, language, truncated);
      log.info('scanWithSemgrep result', { 
        filename, 
        language, 
        findings: res.summary.total,
        by_severity: res.summary.bySeverity,
        by_category: res.summary.byCategory
      });
      return res;
    } catch (e) {
      log.error('Semgrep sync error, attempting fallback', { 
        filename, 
        language, 
        error: String(e && e.message ? e.message : e),
        stack: e?.stack
      });
      try {
        log.info('Attempting manual scan fallback', { filename, language });
        const { scanManual } = require('./manual');
        const fallback = scanManual(truncated, filename);
        log.info('Manual scan fallback successful', { 
          filename, 
          findings: fallback.summary.total,
          provider: 'manual'
        });
        return { ...fallback, provider: 'manual', note: 'semgrep_failed_fallback' };
      } catch (inner) {
        log.error('Both Semgrep and manual scan failed', { 
          filename, 
          language,
          semgrep_error: String(e && e.message ? e.message : e),
          manual_error: String(inner && inner.message ? inner.message : inner)
        });
        return {
          filename,
          language,
          summary: { total: 0, byCategory: {}, bySeverity: {} },
          findings: [],
          lines: String(truncated).split(/\r?\n/).length,
          truncated: String(code).length > MAX_CHARS,
          generatedAt: new Date().toISOString(),
          error: String(e && e.message ? e.message : e),
        };
      }
    }
  } finally {
    log.debug('Cleaning up temporary directory', { tmpdir });
    try { 
      fs.rmSync(tmpdir, { recursive: true, force: true }); 
      log.debug('Temporary directory cleaned up successfully', { tmpdir });
    } catch (cleanupError) {
      log.warn('Failed to clean up temporary directory', { tmpdir, error: cleanupError.message });
    }
  }
}
