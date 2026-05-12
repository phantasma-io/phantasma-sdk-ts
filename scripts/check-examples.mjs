import { spawnSync } from 'node:child_process';
import path from 'node:path';

const root = process.cwd();
const tscBin = path.join(root, 'node_modules', 'typescript', 'bin', 'tsc');
const result = spawnSync(
  process.execPath,
  [tscBin, '-p', 'tsconfig.examples.json', '--pretty', 'false'],
  {
    cwd: root,
    encoding: 'utf8',
  }
);

if (result.status !== 0) {
  process.stdout.write(result.stdout);
  process.stderr.write(result.stderr);
  process.exit(result.status ?? 1);
}
