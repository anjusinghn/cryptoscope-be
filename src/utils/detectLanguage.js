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
