import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const srcRoot = path.join(root, 'src');
const coreRoot = path.join(srcRoot, 'core');
const allowedSegmentPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*\.ts$|^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const violations = [];

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

for (const file of walk(srcRoot)) {
  if (file.startsWith(coreRoot + path.sep)) {
    continue;
  }

  const relative = path.relative(srcRoot, file);
  for (const segment of relative.split(path.sep)) {
    if (segment === 'index.ts') {
      continue;
    }

    if (!allowedSegmentPattern.test(segment)) {
      violations.push(relative);
      break;
    }
  }
}

if (violations.length > 0) {
  console.error('Non-core source files must use lowercase kebab-case paths:');
  for (const violation of violations) {
    console.error(`  ${violation}`);
  }
  process.exit(1);
}
