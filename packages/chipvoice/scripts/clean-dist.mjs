import { rmSync } from 'node:fs';
// Deleted modules/worklet entry points must not remain in the npm tarball.
rmSync(new URL('../dist/', import.meta.url), { recursive: true, force: true });
