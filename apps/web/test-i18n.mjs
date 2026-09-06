import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import ts from 'typescript';
import {build} from '../../packages/chipvoice/node_modules/esbuild/lib/main.js';
await build({entryPoints:['src/i18n/core.ts'],outfile:'generated/test-i18n.mjs',bundle:true,platform:'node',format:'esm',logLevel:'silent'});
const {createTranslator,localePath}=await import('./generated/test-i18n.mjs');
const en=JSON.parse(await readFile('src/i18n/messages/en.json','utf8')),ja=JSON.parse(await readFile('src/i18n/messages/ja.json','utf8')),t=createTranslator(ja);
assert.deepEqual(Object.keys(en).sort(),Object.keys(ja).sort(),'both catalogues contain the same keys');
for(const key of JSON.parse(await readFile('src/i18n/source-templates.json','utf8')))assert.ok(Object.hasOwn(en,key),`source template without translation: ${key}`);
const placeholders=s=>[...s.matchAll(/\{(\w+)\}/g)].map(m=>m[1]).sort();
for(const [key,value]of Object.entries(ja)){assert.equal(typeof value,'string');assert.deepEqual(placeholders(key),placeholders(value),`placeholders: ${key}`);}
assert.equal(t.source('Some unrelated words of this channel'),'Some unrelated words of this channel');
assert.equal(t('Play'),'再生');assert.equal(t('  '),'  ');assert.equal(t('constructor'),'constructor');assert.equal(t('toString'),'toString');
assert.equal(t('{v0} notes omitted.',{v0:7}),'7 個の音符を省略。');assert.equal(t.source('Channel 12: controller 10 is not reproduced'),'チャンネル 12：コントローラー 10 は再現していません');
assert.equal(t('{elapsed} of {duration}',{elapsed:'0:03',duration:'1:28'}),'1:28 中 0:03');
for(const locale of ['en','ja'])for(const path of ['/','/about#credits','/lab','/s/12345678?x=1#score'])assert.equal(localePath(localePath(path,locale),'en'),path);
assert.equal(localePath('/ja#score','en'),'/#score');
assert.equal(localePath('/?mode=compose','ja'),'/ja?mode=compose');
assert.equal(localePath('https://example.org','ja'),'https://example.org');
const missing=new Set();
const covered=text=>Object.hasOwn(en,text.trim())||t.source(text)!==text;
const check=text=>{if(text&&/[A-Za-z]/.test(text)&&!covered(text))missing.add(text);};
// Guard all literal JSX text/accessible labels, plus literals in presentation
// expressions (including conditional branches). Identifiers and user content
// are deliberately not translated by this source audit.
const invariant=/^(?:[A-G](?:#|b)?\d|[A-Z]|[a-z]|\d[\d:./ -]*|[%+−↗↻↤▶Ⅱ■●□〈〉/·→←=.#\s-]*|(?:p1|p2|tri|noi|2a03|dmg|md|snes|c64)|mix|imported)$/;
async function walk(dir){for(const entry of await readdir(dir,{withFileTypes:true})){const path=`${dir}/${entry.name}`;if(entry.isDirectory())await walk(path);else if(path.endsWith('.tsx')&&!path.includes('/card/')){
 const source=await readFile(path,'utf8'),tree=ts.createSourceFile(path,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
 function literals(node){if(ts.isStringLiteral(node)&&!invariant.test(node.text))check(node.text);else if(ts.isConditionalExpression(node)){literals(node.whenTrue);literals(node.whenFalse);}else if(ts.isBinaryExpression(node)){literals(node.left);literals(node.right);}}
 function visit(node,inCode=false){if(ts.isJsxElement(node)&&['pre','code'].includes(node.openingElement.tagName.getText(tree)))inCode=true;
 if(!inCode&&ts.isJsxText(node)&&/[A-Za-z]/.test(node.text)&&node.text.trim()!=='English')missing.add(`Untranslated JSX literal: ${node.text.trim()}`);
 if(ts.isCallExpression(node)&&node.expression.getText(tree)==='t'&&node.arguments[0])literals(node.arguments[0]);
 if(ts.isJsxAttribute(node)&&['aria-label','title','placeholder','alt','label','unit'].includes(node.name.getText(tree))&&node.initializer&&ts.isStringLiteral(node.initializer))check(node.initializer.text);
 ts.forEachChild(node,child=>visit(child,inCode));}visit(tree);
}}}
await walk('src');
// Every published built-in name and evidence paragraph also needs a translation.
const dataInvariant=/^(?:.*\.mid|[A-Z][a-z]* \d{1,2}|Independent NSF emulator)$/;
function data(value,key=''){if(Array.isArray(value))value.forEach(v=>data(v,key));else if(value&&typeof value==='object')for(const[k,v]of Object.entries(value))data(v,k);else if(typeof value==='string'&&['title','name','description','detail','notices','adaptation','excerpt'].includes(key)&&!dataInvariant.test(value))check(value);}
for(const file of ['generated/arrangement-catalogue.json','public/arrangement-data/report.json','public/lab-data/report.json','src/studio/classics.json'])data(JSON.parse(await readFile(file,'utf8')));
assert.deepEqual([...missing].sort(),[],'site-owned copy without a Japanese translation');
console.log(`PASS i18n: ${Object.keys(en).length} keys, placeholders, literal UI/accessibility and published evidence coverage, routes and template translation`);
