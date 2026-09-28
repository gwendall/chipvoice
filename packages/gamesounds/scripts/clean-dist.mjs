import { rmSync } from 'node:fs';
// A deleted or renamed module must not remain in the npm tarball.
rmSync(new URL('../dist/', import.meta.url), { recursive: true, force: true });
