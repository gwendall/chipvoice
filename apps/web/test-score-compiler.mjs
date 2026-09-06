import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {compileRecipe} from './scripts/scores/compile.mjs';
const recipes=JSON.parse(await readFile(new URL('../../scores/classics.json',import.meta.url),'utf8'));
for(const recipe of recipes){const cartridge=compileRecipe(recipe);assert.equal(cartridge.song.patterns.length,4);assert.equal(cartridge.quantization.length>0,recipe.id==='zelda');for(const pattern of cartridge.song.patterns)for(const role of ['lead','chord','bass','perc'])assert.equal(pattern[role].split(' ').length,16);}
const invalid=structuredClone(recipes[0]);invalid.bars[0].melody='C4:3';assert.throws(()=>compileRecipe(invalid),/expected 4/);
invalid.bars[0].melody='C4:1/3 D4:1/3 E4:1/3 C4:3';assert.throws(()=>compileRecipe(invalid),/unsupported rhythm/);
invalid.bars[0].melody='C4:1/100 C4:3.99';assert.throws(()=>compileRecipe(invalid),/does not fit/);
invalid.bars[0].melody='wat:4';assert.throws(()=>compileRecipe(invalid),/Invalid note/);
console.log('PASS reviewed score recipes, complete measures, explicit quantization and rejection of invalid rhythms');
