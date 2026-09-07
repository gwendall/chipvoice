# Complete arrangements and repeatable console porting

<p align="center">
  <a href="README.md">English</a> &bull;
  <a href="README_ja.md">日本語</a>
</p>

The [playground](https://chipvoice.dev) plays each song's native commands on its
original console. Selecting a cartridge selects that console; other consoles
are explicit adaptations. All three songs have an independent reference for A/B.

| Piece | Native source | Verification |
| --- | --- | --- |
| Mario · Ground Theme | NTSC NSF; intro + 5,184-frame loop; 88.5375 s | 41,999 musical writes match Game_Music_Emu, including absolute CPU cycles |
| Zelda · Overworld | Banked NTSC NES NSF, track 2; intro + 1,920-frame repeated cycle | 28,306 musical writes match Game_Music_Emu at the same CPU cycle; NES version, not Famicom Disk System |
| Sonic · Green Hill Zone | NTSC Mega Drive VGM; 53.1993 s, loop begins at 14.7993 s | All 458,039 FM/PSG/DAC commands match GME at VGM sample timestamps; six FM voices and both DAC pins also match Nuked-OPN2 over 68,010,485 internal clocks |

Sonic and Zelda previously used fan MIDI transcriptions. Those verified notes
against the MIDI, not the original game. Sonic's MIDI adaptation omitted 291
notes and had no original DAC sample writes, versus 448,596 in the native source.
Native playback now preserves the game's settings and samples. Source URLs,
credits, hashes and limitations are in the source JSON and reference manifests.

## Three interfaces, one audio engine

- `Score` and presets: a simple musical API for games and composition.
- `Performance`, custom instruments and expression: polyphonic musical data and
  explicit allocation, with every omitted note and instrument substitution reported.
- Native register plans: original hardware commands through the same chip cores.
  Emulation implements the chip's rules, not a finite catalogue of possible sounds.

```ts
import {importVgm, renderPerformance, isolateNativePerformance, mdChip, toWav} from 'chipvoice';

const native = importVgm(vgmBytes);
const wav = toWav(renderPerformance(native, mdChip));
const drums = isolateNativePerformance(native, ['fm6']);
```

`importVgm` accepts uncompressed VGM 1.50–1.71 using NTSC Mega Drive YM2612 and
SN76489 clocks/configuration. Supported commands are FM/PSG writes, waits,
DAC data blocks, PCM seeks and DAC write/waits. Unknown commands, alternate
hardware, malformed input and invalid loop offsets fail explicitly. Limits:
8 MiB, ten minutes, two million bus writes. DAC banks use one bounded buffer;
no per-sample sample-bank allocation. VGM timing has 44,100 ticks/second and
cannot recover the game's sub-sample CPU bus timing. Browser rendering stays in a
replaceable worker; the compact VGM is fetched only when needed for native solo.

```ts
import {importMidi, planPerformance, renderPerformance, snesChip} from 'chipvoice';

const score = importMidi(midiBytes, {title: 'My arrangement'});
const plan = planPerformance(score, snesChip, {allowLoss: true});
console.log(score.notices, plan.losses);
const audio = renderPerformance(plan, snesChip);
```

MIDI SMF 0/1 PPQ import preserves source ticks, polyphony, velocity, programs,
volume/expression, bends and sustain. Unsupported controllers are reported.
Bounds remain 8 MiB, 256 tracks, 250,000 channel events, 100,000 notes and 200,000
expanded expression points. UTF-8 falls back explicitly to Windows-1252.
No bass, chord, drum or arpeggio is invented to fill a missing source part.

## Native source reproduction

Downloaded archives, executable game files and oracle builds stay in local
`.artifacts`. Selected credited audio logs and recordings are demo assets under
decision 29, outside the library code licence. The NES executable
bytes are not bundled; the Sonic VGM contains sound commands/sample data, not
an executable ROM. Use the credited source and exact hash in each source JSON.

```sh
python3 scores/arrangements/native-oracle.py mario.nsf .artifacts/arrangements
node scores/arrangements/capture-mario.mjs mario.nsf .artifacts/reproduced
python3 scores/arrangements/native-oracle.py zelda.nsf .artifacts/native-songs/zelda-oracle 100 1
node scores/arrangements/capture-zelda.mjs zelda.nsf .artifacts/reproduced
python3 scores/arrangements/vgm-oracle.py sonic.vgm .artifacts/native-songs/sonic-oracle 54
node scores/arrangements/capture-sonic.mjs sonic.vgm .artifacts/reproduced
node scores/arrangements/verify-native-songs.mjs
node scores/arrangements/verify-ym-native.mjs
```

The independent GME revision is `fe8da4b6d3876d7542c2fb69d94487e19836d678`.
Only logging is patched; its decoder, CPU, emulation, filters and resampler are
unchanged. NES comparison begins at the first musical PLAY, with initialization
specified separately. NSF capture supports banked/unbanked NTSC 2A03 NSF v1;
expansion hardware, hardware reads and unsupported CPU instructions fail.
Zelda's entire 1,920-frame repeated command cycle is checked, as Mario's 5,184 is.

Sonic's bus is independently reconstructed from GME's decoded VGM trace and
fed into native Nuked-OPN2. Logical VGM writes are serialized with the
reference buffered-write policy: 15 internal clocks between FM port bytes.
This avoids overwriting pending operator/pitch settings in sample-coincident
batches; it does not recover the original CPU bus timing. A streaming SHA-256 covers every six-channel output
and both DAC pins after every internal clock, over the full song. The reference
manifest records the result and its scope. No pitch rounding, time warping or
arbitrary audio alignment is used to make these native checks pass.

## Portable observation is not native emulation

NES note attacks and envelope/timer state are observed at 240 Hz by our core.
Sonic's portable observer extracts normal FM key-on/off, frequency changes and
patches, PSG tone activity and DAC bursts. These observers produce the score
view and other-console arrangements. They are **not independent musical oracles**.
Reviewed extraction checksums detect changes; untouched native commands remain
truth for native playback. FM envelopes/release tails, stereo and exact DAC drum
identities are not fully recovered into portable notes. DAC bursts currently use
a generic percussion mapping; only native Mega Drive retains the original samples.

The allocator reserves higher-priority intervals first and reports all losses.
It does not shorten or steal allocated notes. Solo follows allocation on ports;
native solo masks hardware enables/key-ons/volumes while retaining shared
register latches, FM timing and the PSG tone-3 noise clock. A four-voice console
cannot preserve every simultaneous sound from an eight-part Mega Drive piece.
Edited tempo/transpose use the musical representation and are labelled adaptations.

## Evaluate and publish a snapshot

```sh
pnpm --filter chipvoice build
pnpm arrangements:check
pnpm arrangements:eval
node scores/arrangements/verify-publication.mjs
```

Evaluation sequentially renders all twelve mixes twice, checks identical repeat
PCM, finite/unclipped output and SNES internal dry/echo headroom. Lossless FLAC
and the report go to `apps/web/public/arrangement-data/`; WAV stays in artifacts.
Publication verification binds the current SDK, source, evaluation method,
independent evidence, full decoded durations and lossless WAV/FLAC identity.
Missing references or an adaptation substituted on the original console fail.

The independent PCM comes from GME, whose filters and resampler differ from ours.
Equal register or digital-core results do not imply identical final PCM or a
measured physical console. Analog output and PSG accuracy retain their existing
conformance limits. A/B uses shared timing and attenuation-only level matching,
not a universal fidelity percentage.

<a id="long-midi-import-regression"></a>
## Playback and MIDI regression

The homepage contains the deck; `/lab/arrangements` redirects there. `/lab` keeps
technical engine comparisons, and **Make a loop** keeps the compact tracker.
Full-song seek, restart and loop controls use source timing. Parameter changes
prepare in a worker while current audio continues; canceled work cannot commit.
Native solo keeps original sounds. A/B is disabled on edited/solo versions.
Loading and import errors are visible; Stop remains authoritative.

```sh
SITE=http://127.0.0.1:3074 node apps/web/test-midi-import.mjs
SITE=http://127.0.0.1:3074 node apps/web/test-native-songs.mjs
```

The tests exercise actual browser playback, loading, source selection, native
A/B, solo and mobile layout. Artifacts include screenshots and measured output.
See the [transport specification](../../docs/UNIFIED-PLAYGROUND.md).
