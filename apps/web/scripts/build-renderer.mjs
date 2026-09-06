import { build } from '../../../packages/chipvoice/node_modules/esbuild/lib/main.js';
await build({ entryPoints: ['src/lib/audio-worker.ts'], outfile: 'generated/audio-render.cjs', bundle: true, platform: 'node', target: 'node22', format: 'cjs', minify: true, logLevel: 'warning' });
