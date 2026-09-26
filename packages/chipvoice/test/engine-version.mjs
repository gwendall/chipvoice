import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PROJECT_ENGINE_VERSION} from '../dist/index.js';
// Renders report this version and the skill installs it, so it must be the
// version npm serves for this code. It stayed at 0.17.0 through two releases
// once, pointing agents at an older package than the site ran.
const {version}=JSON.parse(readFileSync(new URL('../package.json',import.meta.url),'utf8'));
assert.equal(PROJECT_ENGINE_VERSION,version,'bump PROJECT_ENGINE_VERSION with package.json');
console.log(`PASS the project engine version is the package version, ${version}`);
