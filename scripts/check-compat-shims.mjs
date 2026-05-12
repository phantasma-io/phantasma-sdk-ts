import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const compatRoot = path.join(root, 'src', 'core');

function walk(dir) {
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walk(fullPath));
    } else if (entry.isFile() && entry.name.endsWith('.ts')) {
      files.push(fullPath);
    }
  }
  return files;
}

const exportLinePattern = /^export \* from '([^']+\.js)';$/u;
const violations = [];

for (const file of walk(compatRoot)) {
  const relativeFile = path.relative(root, file);
  const lines = fs
    .readFileSync(file, 'utf8')
    .split(/\r?\n/u)
    .filter((line) => line.length > 0);

  if (lines.length === 0) {
    violations.push(`${relativeFile}: empty compatibility shim`);
    continue;
  }

  for (const line of lines) {
    const match = exportLinePattern.exec(line);
    if (!match) {
      violations.push(`${relativeFile}: compatibility shims may only contain export-star lines`);
      continue;
    }

    const target = path.resolve(path.dirname(file), match[1].replace(/\.js$/u, '.ts'));
    if (!target.startsWith(path.join(root, 'src') + path.sep) || !fs.existsSync(target)) {
      violations.push(`${relativeFile}: shim target does not exist: ${match[1]}`);
    }
  }
}

if (violations.length > 0) {
  console.error('Invalid src/core compatibility shims:');
  for (const violation of violations) {
    console.error(`  ${violation}`);
  }
  process.exit(1);
}
