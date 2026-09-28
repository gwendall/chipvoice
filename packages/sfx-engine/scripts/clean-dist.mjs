import { rmSync } from 'node:fs';
// Deleted modules must not remain in a previous build's leftovers.
rmSync(new URL('../dist/', import.meta.url), { recursive: true, force: true });
