import { readdirSync } from 'node:fs';
import { spawn } from 'node:child_process';

/**
 * Runs every unit test under test/*.test.mjs through `node --test`, following
 * decision 37 (packages/chipvoice's own `test:unit`): one process, every file
 * reported regardless of an earlier failure, a new file joins the moment it
 * exists on disk.
 */
const testDir = new URL('../test/', import.meta.url);
const files = readdirSync(testDir)
  .filter((name) => name.endsWith('.test.mjs'))
  .sort()
  .map((name) => `test/${name}`);

const child = spawn(process.execPath, ['--test', '--test-concurrency=4', ...files], { stdio: 'inherit' });
child.on('exit', (code) => process.exit(code ?? 1));
