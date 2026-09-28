// Phase 1 acceptance: "Runtime unit tests on a fake AudioContext:
// round-robin, jitter bounds, cooldown, voice cap and priority stealing,
// ducking, unlock." Every assertion here reads state off the fake (see
// fake-audio-context.mjs) or off GameSounds's own public handles - nothing
// is taken on faith from src/runtime.ts's implementation.
import assert from "node:assert/strict";
import { loadSounds } from "../src/runtime.ts";
import { FakeAudioContext, fakeFetch } from "./fake-audio-context.mjs";

function manifest(events) {
  return { $schema: "https://gamesounds.ai/schema/manifest-1.json", version: 1, base: "./", events, credits: [] };
}
function event(files, overrides = {}) {
  return { sound: "test-sound", files, ...overrides };
}

// ------------------------------------------------------------- round-robin
{
  const ctx = new FakeAudioContext();
  const sounds = await loadSounds({ manifest: manifest({ jump: event(["a.wav", "b.wav", "c.wav"]) }) }, { context: ctx, fetch: fakeFetch() });
  const variants = [];
  for (let i = 0; i < 7; i++) variants.push(sounds.play("jump").variant);
  assert.deepEqual(variants, [0, 1, 2, 0, 1, 2, 0], "round-robin cycles every variant in order before repeating");
  console.log("PASS round-robin cycles 0,1,2,0,1,2,... across repeated plays");
}

// ------------------------------------------------------------------ jitter
{
  const ctx = new FakeAudioContext();
  const sounds = await loadSounds(
    { manifest: manifest({ hit: event(["a.wav"], { pitchJitter: 0.2 }) }) },
    { context: ctx, fetch: fakeFetch(), random: () => 0 },
  );
  sounds.play("hit");
  const low = ctx.sources.at(-1);
  assert.equal(low.playbackRate.value, 1 - 0.2, "random()=0 hits the jitter's low bound (1 - pitchJitter)");
}
{
  const ctx = new FakeAudioContext();
  const sounds = await loadSounds(
    { manifest: manifest({ hit: event(["a.wav"], { pitchJitter: 0.2 }) }) },
    { context: ctx, fetch: fakeFetch(), random: () => 1 },
  );
  sounds.play("hit");
  const high = ctx.sources.at(-1);
  assert.equal(high.playbackRate.value, 1 + 0.2, "random()=1 hits the jitter's high bound (1 + pitchJitter)");
}
{
  // No jitter configured: random() must never move the pitch, no matter what it returns.
  const ctx = new FakeAudioContext();
  const sounds = await loadSounds({ manifest: manifest({ hit: event(["a.wav"]) }) }, { context: ctx, fetch: fakeFetch(), random: () => 0.5 });
  sounds.play("hit");
  assert.equal(ctx.sources.at(-1).playbackRate.value, 1, "an event with no pitchJitter is never detuned by chance");
  console.log("PASS pitch jitter hits both bounds exactly and never fires when unconfigured");
}
{
  // `detune` (PlayOptions) stacks on top of jitter, in semitones.
  const ctx = new FakeAudioContext();
  const sounds = await loadSounds({ manifest: manifest({ hit: event(["a.wav"]) }) }, { context: ctx, fetch: fakeFetch() });
  sounds.play("hit", { detune: 1200 });
  assert.equal(ctx.sources.at(-1).playbackRate.value, 1 + 12, "1200 cents (12 semitones) doubles playback rate on top of the base 1");
  console.log("PASS PlayOptions.detune stacks correctly on top of the base playback rate");
}

// ----------------------------------------------------------------- cooldown
{
  const ctx = new FakeAudioContext();
  const sounds = await loadSounds({ manifest: manifest({ shoot: event(["a.wav"], { cooldownMs: 100 }) }) }, { context: ctx, fetch: fakeFetch() });
  const first = sounds.play("shoot");
  assert.ok(first.variant >= 0 && first.playing, "the first trigger always plays");
  const tooSoon = sounds.play("shoot");
  assert.equal(tooSoon.variant, -1, "a trigger inside the cooldown window is refused");
  assert.equal(tooSoon.playing, false);
  ctx.currentTime += 0.099;
  assert.equal(sounds.play("shoot").variant, -1, "1ms short of the cooldown is still refused");
  ctx.currentTime += 0.002;
  const afterCooldown = sounds.play("shoot");
  assert.ok(afterCooldown.variant >= 0 && afterCooldown.playing, "once the cooldown elapses, the event plays again");
  console.log("PASS cooldownMs blocks retriggers until it elapses, to the millisecond");
}

// ------------------------------------------------- voice cap and stealing
{
  // Per-event cap: the 3rd voice steals the oldest when maxVoices is 2 and
  // every voice shares one priority (weakestVoice's "nothing strictly
  // weaker; fall back to oldest at the same priority" path).
  const ctx = new FakeAudioContext();
  const sounds = await loadSounds({ manifest: manifest({ spark: event(["a.wav"], { maxVoices: 2, priority: 1 }) }) }, { context: ctx, fetch: fakeFetch() });
  const h1 = sounds.play("spark");
  ctx.currentTime += 0.01;
  const h2 = sounds.play("spark");
  ctx.currentTime += 0.01;
  assert.ok(h1.playing && h2.playing, "both voices fit under the cap of 2");
  const h3 = sounds.play("spark");
  assert.ok(h3.playing, "a 3rd trigger still plays by stealing a slot");
  assert.equal(h1.playing, false, "the oldest voice was stolen to make room for the 3rd");
  assert.ok(h2.playing, "the 2nd voice (not the oldest) survives the steal");
  console.log("PASS a per-event voice cap steals the oldest voice once full");
}
{
  // Global cap, priority stealing across two different events sharing it.
  const ctx = new FakeAudioContext();
  const sounds = await loadSounds(
    { manifest: manifest({ low: event(["a.wav"], { priority: 1, maxVoices: 10 }), high: event(["a.wav"], { priority: 5, maxVoices: 10 }) }) },
    { context: ctx, fetch: fakeFetch(), maxVoices: 1 },
  );
  const lowVoice = sounds.play("low");
  assert.ok(lowVoice.playing);
  const highVoice = sounds.play("high");
  assert.ok(highVoice.playing, "a higher-priority sound always finds room");
  assert.equal(lowVoice.playing, false, "the lower-priority voice was stolen to make room for the higher one");

  const secondLow = sounds.play("low");
  assert.equal(secondLow.variant, -1, "a lower-priority sound cannot steal a strictly higher-priority voice");
  assert.equal(secondLow.playing, false);
  assert.ok(highVoice.playing, "the higher-priority voice survives a failed steal attempt against it");
  console.log("PASS priority stealing: higher priority always wins the global cap, lower priority never steals up");
}

// ------------------------------------------------------------------ ducking
{
  const ctx = new FakeAudioContext();
  const sounds = await loadSounds({ manifest: manifest({}) }, { context: ctx, fetch: fakeFetch() });
  const music = sounds.bus("music");
  assert.equal(music.volume(), 1, "a new bus starts at volume 1");

  music.duck(0.4);
  const ramps = music.node.gain.calls.filter((c) => c[0] === "linearRampToValueAtTime");
  assert.equal(ramps.length, 2, "duck() schedules exactly an attack ramp and a release ramp");
  assert.ok(Math.abs(ramps[0][1] - 0.6) < 1e-9, "attack ramps to base * (1 - amount) = 0.6");
  assert.ok(Math.abs(ramps[0][2] - 0.02) < 1e-9, "default attack is 0.02s");
  assert.ok(Math.abs(ramps[1][1] - 1) < 1e-9, "release ramps back to the bus's own volume");
  assert.ok(Math.abs(ramps[1][2] - 0.32) < 1e-9, "release lands at attack(0.02) + release(0.3)");

  music.volume(0.5);
  assert.equal(music.volume(), 0.5, "volume() both sets and reads the base");
  music.duck(0.5, { attack: 0.1, release: 1 });
  const ramps2 = music.node.gain.calls.filter((c) => c[0] === "linearRampToValueAtTime").slice(-2);
  assert.ok(Math.abs(ramps2[0][1] - 0.25) < 1e-9, "duck target scales with the bus's current (changed) volume");
  assert.ok(Math.abs(ramps2[0][2] - 0.1) < 1e-9, "a custom attack is honoured");
  assert.ok(Math.abs(ramps2[1][2] - 1.1) < 1e-9, "a custom release is honoured");
  console.log("PASS bus.duck() schedules the right attack/release ramp, with and without custom timing");
}

// ------------------------------------------------------------------- unlock
{
  const ctx = new FakeAudioContext();
  ctx.state = "suspended";
  const sounds = await loadSounds({ manifest: manifest({}) }, { context: ctx, fetch: fakeFetch() });
  assert.equal(ctx.resumeCalls, 0);

  sounds.unlock();
  assert.equal(ctx.resumeCalls, 1, "unlock() resumes a suspended context");
  const afterFirst = ctx.sources.length;
  assert.ok(afterFirst >= 1, "unlock() starts one silent buffer, required inside the same gesture on iOS");
  assert.equal(ctx.sources.at(-1).startCalls.length, 1);

  sounds.unlock();
  assert.equal(ctx.resumeCalls, 1, "a second unlock() call does not resume again");
  assert.equal(ctx.sources.length, afterFirst, "a second unlock() call starts no extra buffer");
  console.log("PASS unlock() resumes and plays one silent buffer exactly once, safe to call again");
}

// -------------------------------------------------------- loop points, stop
{
  const ctx = new FakeAudioContext();
  const sounds = await loadSounds({ manifest: manifest({ amb: event(["a.wav"], { loop: { start: 0.5, end: 1.5 } }) }) }, { context: ctx, fetch: fakeFetch() });
  const handle = sounds.loop("amb");
  const source = ctx.sources.at(-1);
  assert.equal(source.loop, true);
  assert.equal(source.loopStart, 0.5);
  assert.equal(source.loopEnd, 1.5);
  assert.ok(handle.playing);
  handle.stop();
  assert.equal(handle.playing, false, "stop() removes the voice from the active set at once");
  assert.ok(source.stopped, "stop() actually stops the underlying source");
  console.log("PASS loop() applies the manifest's own loop points and stop() ends it immediately");
}
