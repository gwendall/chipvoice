import assert from 'node:assert/strict';
import { build } from '../../packages/chipvoice/node_modules/esbuild/lib/main.js';
await build({ entryPoints: ['src/auth/session-cache.ts'], outfile: 'generated/test-session-cache.mjs', bundle: true, platform: 'node', format: 'esm', logLevel: 'silent' });
class Storage extends Map {
  getItem(key) { return this.get(key) ?? null; }
  setItem(key, value) { this.set(key, value); }
  removeItem(key) { this.delete(key); }
}
globalThis.window = new EventTarget();
globalThis.document = Object.assign(new EventTarget(), { cookie: 'chipvoice_session_revision=first', visibilityState: 'visible' });
globalThis.sessionStorage = new Storage();
globalThis.localStorage = new Storage();
let now = Date.now();
Date.now = () => now;
const requests = [];
globalThis.fetch = (_url, options) => new Promise(resolve => requests.push({ options, resolve }));
const settle = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };
const identity = (revision = 'first', name = 'First') => ({ revision, userId: name, email: name + '@example.test', profile: { id: name, displayName: name, handle: null, avatar: null } });
const respond = async (index, body, status = 200) => {
  requests[index].resolve({ ok: status === 200, status, json: async () => body });
  await settle();
};
const store = await import('./generated/test-session-cache.mjs');
const first = store.subscribeSession(() => {}), second = store.subscribeSession(() => {});
assert.equal(requests.length, 1, 'consumers share one pending identity request');
first(); second();
assert.equal(requests[0].options.signal.aborted, false, 'route unmount does not cancel shared work');
const unsubscribe = store.subscribeSession(() => {});
await respond(0, identity());
assert.equal(store.sessionSnapshot().profile.id, 'First');
for (let i = 0; i < 5; i++) window.dispatchEvent(new Event('focus'));
assert.equal(requests.length, 1, 'fresh identity survives repeated focus');
now += store.SESSION_CACHE_TTL + 1;
window.dispatchEvent(new Event('focus'));
window.dispatchEvent(new Event('focus'));
assert.equal(requests.length, 2);
assert.equal(store.sessionSnapshot().status, 'signed-in', 'refresh keeps the avatar visible');
await respond(1, { error: 'unavailable' }, 503);
assert.equal(store.sessionSnapshot().profile.id, 'First', 'outage preserves known identity');
window.dispatchEvent(new Event('focus'));
assert.equal(requests.length, 2, 'outage does not cause a retry storm');

// A response from before a login must never repaint the old account, even if
// fetch ignores cancellation. Only redemption/logout can change the marker.
store.refreshSession(true);
document.cookie = 'chipvoice_session_revision=second';
await respond(2, identity());
assert.equal(store.sessionSnapshot().status, 'checking');
assert.equal(requests.length, 4, 'marker mismatch rechecks the new session');
await respond(3, identity('second', 'Second'));
assert.equal(store.sessionSnapshot().profile.id, 'Second');
store.refreshSession(true);
store.invalidateSession();
assert.equal(requests[4].options.signal.aborted, true);
await respond(4, identity('second', 'Old portrait'));
assert.equal(store.sessionSnapshot().status, 'checking', 'aborted responses cannot restore stale metadata');
await respond(5, identity('second', 'Updated portrait'));
assert.equal(store.sessionSnapshot().profile.id, 'Updated portrait');
assert.equal(localStorage.size, 1);
assert.match(localStorage.getItem('chipvoice-session-change'), /^[\da-f-]{36}$/i, 'cross-tab signal contains no identity or credential');

document.cookie = '';
window.dispatchEvent(Object.assign(new Event('storage'), { key: 'chipvoice-session-change' }));
assert.equal(store.sessionSnapshot().email, null, 'logout clears the previous identity immediately');
await respond(6, { revision: '', error: 'not_signed_in' }, 401);
assert.equal(store.sessionSnapshot().status, 'anonymous');
assert.equal(JSON.parse(sessionStorage.getItem(store.SESSION_CACHE_KEY)).view.profile, null);
// A malformed successful response fails once instead of restarting forever.
store.refreshSession(true);
const last = requests.length - 1;
await respond(last, { email: 'bad@example.test', userId: 'bad', profile: { id: 'bad' } });
assert.equal(requests.length, last + 1);
unsubscribe();

// A hard reload can paint a stale snapshot while one background check runs.
document.cookie = 'chipvoice_session_revision=reload';
sessionStorage.setItem(store.SESSION_CACHE_KEY, JSON.stringify({ revision: 'reload', checkedAt: now - store.SESSION_CACHE_TTL - 1, view: { ...identity('reload', 'Reload'), status: 'signed-in' } }));
const reloaded = await import('./generated/test-session-cache.mjs?reload');
assert.equal(reloaded.sessionSnapshot().profile.id, 'Reload');
const before = requests.length;
const stop = reloaded.subscribeSession(() => {});
assert.equal(requests.length, before + 1);
await respond(before, { revision: 'reload' }, 401);
assert.equal(reloaded.sessionSnapshot().status, 'anonymous', 'server rejection replaces cached presentation');
stop();
console.log('PASS session cache: deduplication, TTL, outage, late responses, account switch, cross-tab logout and stale reload');
