import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { nesChip } from 'chipvoice';
import { buildScript } from './script.mjs';
import { runRom } from './run-rom.mjs';
import { AnalogStage, renderThroughStage } from './dsp-lite.mjs';
import { writeWav24 } from './wav.mjs';

/**
 * `bench:nes:render`: runs the committed bench ROM on the harness's 6502 and
 * renders what it wrote two ways, both at 96 kHz:
 *
 * - the "profile" render, through `nesChip`'s own `NesApuCore` - the real
 *   shipping core and its shipping `nesdev` output profile, unmodified;
 * - the "flat" render, through the digital core alone (`nesChip.digital()`)
 *   and this bench's own DAC-curve-only stage (`dsp-lite.mjs`'s
 *   `AnalogStage` with no filters) - what the chip's mixer alone would put
 *   on the pins before any console-specific filtering, the reference
 *   `compare.mjs` measures a captured unit's own filtering against.
 *
 *   node src/bench/render.mjs [--rom <file>] [--out-dir <dir>] [--rate 96000]
 */
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export function renderScript(romPath, sampleRate = 96000) {
  const rom = new Uint8Array(fs.readFileSync(romPath));
  const script = buildScript();
  const { log, cycles } = runRom(rom, script.totalFrames);

  const profileCore = nesChip.create(sampleRate);
  profileCore.setGain(1);
  profileCore.schedule(log);
  const totalSamples = Math.ceil((cycles * sampleRate) / 1789773);
  const profile = new Float32Array(totalSamples);
  for (let at = 0; at < totalSamples; at += 4096) profileCore.render(profile.subarray(at, Math.min(totalSamples, at + 4096)), null, at);

  const digital = nesChip.digital();
  digital.schedule(log);
  const flat = renderThroughStage(digital, new AnalogStage({}, sampleRate), sampleRate, cycles);

  return { script, log, cycles, sampleRate, profile, flat };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const option = (name, fallback) => {
    const i = args.indexOf(`--${name}`);
    return i >= 0 ? args[i + 1] : fallback;
  };
  const romPath = option('rom', path.join(ROOT, 'roms', 'bench', 'nes-analog-script.nes'));
  const outDir = option('out-dir', path.join(ROOT, '.artifacts', 'nes-bench'));
  const sampleRate = Number(option('rate', '96000'));

  const { profile, flat, cycles, script } = renderScript(romPath, sampleRate);
  fs.mkdirSync(outDir, { recursive: true });
  const profilePath = path.join(outDir, 'nes-analog-script.profile.wav');
  const flatPath = path.join(outDir, 'nes-analog-script.flat.wav');
  fs.writeFileSync(profilePath, writeWav24(profile, sampleRate));
  fs.writeFileSync(flatPath, writeWav24(flat, sampleRate));
  console.log(`wrote ${profilePath} (nesdev profile, ${(profile.length / sampleRate).toFixed(2)} s)`);
  console.log(`wrote ${flatPath} (profile-free, DAC curve only, ${(flat.length / sampleRate).toFixed(2)} s)`);
  console.log(`${script.totalFrames} frames, ${cycles} CPU cycles, ${script.writes.length} register writes`);
}
