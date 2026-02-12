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
