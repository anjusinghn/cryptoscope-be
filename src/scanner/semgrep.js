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
