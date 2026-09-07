import {readFile} from 'node:fs/promises';
import {importVgm} from '../../packages/chipvoice/dist/index.js';
export const nativeSources = {
 mario: {chip:'2a03',file:'mario-native.json',format:'json',artifacts:'.artifacts/arrangements',pcm:'mario-gme.pcm'},
 zelda: {chip:'2a03',file:'zelda-native.json',format:'json',artifacts:'.artifacts/native-songs/zelda-oracle',pcm:'mario-gme.pcm'},
 sonic: {chip:'md',file:'sonic-native.vgm',format:'vgm',artifacts:'.artifacts/native-songs/sonic-oracle',pcm:'reference.pcm'},
};
export async function loadNative(id) {
 const spec=nativeSources[id];if(!spec)throw Error(`No native source for ${id}`);
 const bytes=await readFile(new URL(spec.file,import.meta.url));
 if(spec.format!=='vgm')return JSON.parse(bytes);
 const sourceCommands=[];
 const plan=importVgm(bytes,{onCommand:(...command)=>sourceCommands.push(command)});
 return {...plan,sourceCommands};
}
/** Original VGM timestamps precede physical FM bus serialization. */
export function vgmCommands(plan) {
 if(!plan.sourceCommands)throw Error('Native VGM command capture is missing');
 return plan.sourceCommands;
}
