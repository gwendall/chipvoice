import { build } from '../../../packages/chipvoice/node_modules/esbuild/lib/main.js';
import {mkdir,copyFile} from 'node:fs/promises';
await build({ entryPoints: ['src/lib/audio-worker.ts'], outfile: 'generated/audio-render.cjs', bundle: true, platform: 'node', target: 'node22', format: 'cjs', minify: true, logLevel: 'warning' });
await build({entryPoints:['src/arrangements/render-worker.ts'],outfile:'public/arrangement-render.js',bundle:true,platform:'browser',format:'iife',target:'es2022',minify:true,logLevel:'warning'});
await mkdir('public/arrangement-data',{recursive:true});
for(const id of ['mario','zelda','sonic','mario-native'])await copyFile(`../../scores/arrangements/${id}.json`,`public/arrangement-data/${id}.json`);
