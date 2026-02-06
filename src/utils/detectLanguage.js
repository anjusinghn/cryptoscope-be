function detectLanguage(filename, codeSample = '') {
  const f = (filename || '').toLowerCase();
  if (f.endsWith('.js') || f.endsWith('.mjs') || f.endsWith('.cjs')) return 'javascript';
  if (f.endsWith('.ts') || f.endsWith('.tsx')) return 'typescript';
  if (f.endsWith('.py')) return 'python';
  if (f.endsWith('.java')) return 'java';
  if (f.endsWith('.go')) return 'go';
  if (f.endsWith('.php')) return 'php';
  if (f.endsWith('.cs')) return 'csharp';
  if (f.endsWith('.c')) return 'c';
  if (f.endsWith('.cpp') || f.endsWith('.cc') || f.endsWith('.hpp') || f.endsWith('.h')) return 'cpp';
  if (f.endsWith('.rs')) return 'rust';
  if (f.endsWith('.kt') || f.endsWith('.kts')) return 'kotlin';
  if (f.endsWith('.swift')) return 'swift';
  if (f.endsWith('.rb')) return 'ruby';
  if (f.endsWith('.scala')) return 'scala';

  // Heuristics by content
  const s = codeSample.slice(0, 500).toLowerCase();
  if (/import\s+java\./.test(s) || /class\s+\w+\s*\{/.test(s) && /public\s+static\s+void\s+main/.test(s)) return 'java';
  if (/def\s+\w+\s*\(|import\s+hashlib/.test(s)) return 'python';
  if (/package\s+main|fmt\.Print/.test(s)) return 'go';
  if (/namespace\s+\w+;|using\s+System\./.test(s)) return 'csharp';
  if (/(#include\s*<openssl|#include\s*<stdio\.h>)/.test(s)) return 'c';
  if (/fn\s+main\s*\(|extern\s+crate\s+/.test(s)) return 'rust';
  if (/(<\?php|echo\s+\$\w+)/.test(s)) return 'php';

  return 'any';
}

module.exports = { detectLanguage };

