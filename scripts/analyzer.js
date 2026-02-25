#!/usr/bin/env node
/*
 Simple analyzer CLI that uses all backend API endpoints:
 - /api/scan for single files or pasted code
 - /api/scan-repo-sse to scan a GitHub repo with streaming progress
 - /api/repo-file to fetch file contents
 - /api/rank-severity to classify severity (optional)
 - /api/generate-report to produce a Markdown report

 Usage:
   node be/scripts/analyzer.js scan-file <path>
   node be/scripts/analyzer.js scan-repo <github_url>
*/

const fs = require('fs');
const http = require('http');
const https = require('https');

const API = process.env.ANALYZER_API || 'http://localhost:5050';

async function apiFetch(path, opts = {}) {
  const url = `${API}${path}`;
  return await fetch(url, { ...opts, agent: (u) => u.protocol === 'http:' ? new http.Agent({ keepAlive: true }) : new https.Agent({ keepAlive: true }) });
}

function sevColor(s) {
  const v = String(s);
  if (v === 'high') return '\x1b[31mhigh\x1b[0m';
  if (v === 'warning') return '\x1b[33mwarning\x1b[0m';
  return '\x1b[32minfo\x1b[0m';
}

function printFindings(result) {
  console.log(`\nFile: ${result.filename}  Language: ${result.language}  Findings: ${result.summary.total}`);
  if (!Array.isArray(result.findings) || result.findings.length === 0) {
    console.log('  (no findings)');
    return;
  }
  for (const f of result.findings) {
    console.log(`  ${f.line}:${f.column}  ${sevColor(f.severity)}  ${f.ruleId}`);
    console.log(`    ${f.description}`);
    if (f.recommendation) console.log(`    Fix: ${f.recommendation}`);
    console.log(`    Match: ${f.match}`);
  }
}

async function scanFile(p) {
  const content = fs.readFileSync(p, 'utf8');
  const scanRes = await apiFetch('/api/scan', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: content, filename: p }) });
  if (!scanRes.ok) throw new Error(`scan failed: ${await scanRes.text()}`);
  const result = await scanRes.json();
  printFindings(result);
  // Rank severity (optional)
  if (Array.isArray(result.findings) && result.findings.length > 0) {
    const rankRes = await apiFetch('/api/rank-severity', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ findings: result.findings }) });
    if (rankRes.ok) {
      const ranked = await rankRes.json();
      console.log(`\nRanked severities received (${Array.isArray(ranked?.enriched) ? ranked.enriched.length : 0})`);
    }
    const repRes = await apiFetch('/api/generate-report', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ findings: result.findings, meta: { source: 'cli', filename: p, language: result.language } }) });
    if (repRes.ok) {
      const data = await repRes.json();
      console.log('\n=== Report (Markdown) ===\n');
      console.log(String(data?.report || ''));
    }
  }
}

async function scanRepo(url) {
  console.log(`Starting repo scan: ${url}`);
  const sseUrl = new URL('/api/scan-repo-sse', API);
  sseUrl.searchParams.set('url', url);
  sseUrl.searchParams.set('concurrency', '4');
  const isHttps = sseUrl.protocol === 'https:';
  const mod = isHttps ? https : http;
  const req = mod.request(sseUrl, { headers: { Accept: 'text/event-stream' } }, (res) => {
    res.setEncoding('utf8');
    let buf = '';
    const files = [];
    const findings = [];
    let summary = { total: 0, byCategory: {}, bySeverity: {} };
    res.on('data', (chunk) => {
      buf += chunk;
      const parts = buf.split(/\n\n/);
      buf = parts.pop() || '';
      for (const part of parts) {
        const lines = part.split(/\n/);
        const evLine = lines.find(l => l.startsWith('event: '));
        const dataLine = lines.find(l => l.startsWith('data: '));
        const ev = evLine ? evLine.slice(7).trim() : 'message';
        const data = dataLine ? JSON.parse(dataLine.slice(6)) : null;
        if (ev === 'start') {
          console.log(`Files: ${data.total}`);
        } else if (ev === 'file' && data && !data.error) {
          files.push(data);
          if (Array.isArray(data.findings)) findings.push(...data.findings.map(f => ({ ...f, path: data.path })));
          console.log(`File: ${data.path}  findings: ${data.summary?.total || 0}`);
        } else if (ev === 'progress') {
          process.stdout.write(`\rProgress ${data.done}/${data.total}`);
        } else if (ev === 'done') {
          summary = data.summary || summary;
          console.log(`\nDone. Findings total: ${summary.total}`);
          // Generate a report for the repo
          (async () => {
            const repRes = await apiFetch('/api/generate-report', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ findings, meta: { source: 'cli-repo', repo: url, files: files.length, summary } }) });
            if (repRes.ok) {
              const data = await repRes.json();
              console.log('\n=== Report (Markdown) ===\n');
              console.log(String(data?.report || ''));
            }
          })().catch(() => {});
        }
      }
    });
    res.on('end', () => {});
  });
  req.on('error', (e) => { console.error('SSE error:', e.message); });
