// Checks maintained, static user-facing copy. Comments, tests, dependencies, and generated output are excluded.
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const roots = ['src'];
const sourceExtensions = new Set(['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs']);
const resourceExtensions = new Set(['.html', '.json', '.xml', '.strings', '.stringsdict', '.plist', '.yaml', '.yml']);
const excludedDirectories = new Set(['node_modules', 'dist', 'build', 'coverage', '.git', '.expo', 'Pods']);
const excludedFiles = /(?:^|\.)(?:test|spec|contract)\.[cm]?[jt]sx?$/;
const forbidden = /\u2014|\\u(?:2014|\{2014\})|&(?:mdash|#0*8212|#x0*2014);/gi;
// Add an exception only with an exact file:line and a documented reason.
const exceptions = new Map();
const violations = [];

function check(text, file, line) {
  for (const match of text.matchAll(forbidden)) {
    const matchLine = line + (text.slice(0, match.index).match(/\n/g) || []).length;
    if (!exceptions.has(`${file}:${matchLine}`)) violations.push(`${file}:${matchLine}`);
  }
}

function scanSource(file, contents) {
  const ext = path.extname(file);
  const kind = ext === '.tsx' || ext === '.jsx' ? ts.ScriptKind.TSX
    : ext === '.ts' ? ts.ScriptKind.TS : ts.ScriptKind.JS;
  const ast = ts.createSourceFile(file, contents, ts.ScriptTarget.Latest, true, kind);
  function visit(node) {
    if (ts.isStringLiteralLike(node) || ts.isJsxText(node) || ts.isTemplateLiteralToken(node)) {
      const line = ast.getLineAndCharacterOfPosition(node.getStart(ast)).line + 1;
      check(node.getText(ast), file, line);
      check(node.text || '', file, line);
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
}

function scanResource(file, contents) {
  contents.split(/\r?\n/).forEach((line, index) => check(line, file, index + 1));
}

function walk(entry) {
  if (!fs.existsSync(entry)) return;
  const stats = fs.statSync(entry);
  if (stats.isDirectory()) {
    for (const name of fs.readdirSync(entry)) {
      if (!excludedDirectories.has(name)) walk(path.join(entry, name));
    }
    return;
  }
  if (excludedFiles.test(path.basename(entry))) return;
  const ext = path.extname(entry);
  if (!sourceExtensions.has(ext) && !resourceExtensions.has(ext)) return;
  const contents = fs.readFileSync(entry, 'utf8');
  if (sourceExtensions.has(ext)) scanSource(entry, contents);
  else scanResource(entry, contents);
}

if (process.argv.includes('--self-test')) {
  const assert = require('node:assert/strict');
  const mark = String.fromCodePoint(0x2014);
  scanSource('fixture.ts', [
    `const title = "A ${mark} B";`,
    String.raw`const escaped = "\u2014";`,
    `// ${mark} is only a comment`,
  ].join('\n'));
  scanSource('fixture.tsx', `const ui = <span>A ${mark} B</span>;`);
  scanResource('fixture.html', '<title>A &mdash; B</title>');
  assert.deepEqual([...new Set(violations)].sort(), [
    'fixture.html:1', 'fixture.ts:1', 'fixture.ts:2', 'fixture.tsx:1',
  ]);
  console.log('Official copy check self-test passed.');
  process.exit(0);
}

for (const root of roots) walk(root);
if (violations.length) {
  console.error('Official copy contains a prohibited em dash:');
  for (const violation of [...new Set(violations)].sort()) console.error(`  ${violation}`);
  process.exitCode = 1;
} else {
  console.log('Official copy check passed.');
}
