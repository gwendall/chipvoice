'use client';
import {useEffect, useMemo, useRef, useState} from 'react';
import {useT} from '@/i18n/react';
import {SiteHeader, SiteFooter, PlayButton} from '@/ui/components';
import {MACHINES, ROLE_NAMES, type ChipId} from '../studio/machines';
import catalogueData from '@/data/instrument-catalogue.json';

/**
 * The shape `scores/instruments/generate.mjs` writes to
 * `src/data/instrument-catalogue.json` - see that file, `scores/instruments/presets.mjs`
 * and `scores/instruments/provenance.mjs`. Nothing here is typed by hand:
 * every number and plot on the page below comes straight from this import.
 */
type Timbre =
  | {kind: 'sample'; sample: string}
  | {kind: 'fm'; algorithm: number; operators: number; feedback: number}
  | {kind: 'wavetable'; steps: number}
  | {kind: 'noise'}
  | {kind: 'sawtooth'}
  | {kind: 'triangle'}
  | {kind: 'pulse'; dutyPercent: number | null}
  | {kind: 'tone'};
type Role = 'lead' | 'chord' | 'bass' | 'perc';
type Preset = {
  id: string; chip: ChipId; role: Role;
  program?: number; programs?: number[]; token?: string; drum?: number;
  timbre: Timbre;
  envelope: {attackMs: number; decayMs: number; sustainLevel: number; releaseMs: number; releaseMeasured: boolean; peak: number; curve: number[]};
  spectrum: {centroidHz: number | null; flatness: number; bands: {hz: number; db: number | null}[]};
  levels: {samplePeakDbFS: number | null; rmsDbFS: number | null; crestDb: number | null};
  audio: {file: string; sha256: string; sourceWavSha256: string};
};
type Catalogue = {catalogueVersion: number; engineSha256: string; probe: {pitch: number; velocity: number; noteOnMs: number; totalMs: number; sampleRate: number}; presets: Preset[]};
const data = catalogueData as Catalogue;

const CHIP_ORDER: ChipId[] = ['2a03', 'dmg', 'md', 'snes', 'c64'];
const ROLE_ORDER: Role[] = ['lead', 'chord', 'bass', 'perc'];
const DRUM_NAMES: Record<string, string> = {K: 'Kick', S: 'Snare', H: 'Hi-hat', O: 'Open hi-hat'};
const dbText = (value: number | null) => value === null ? '—' : value.toFixed(1);

/** A note name for the probe's fixed pitch (60 = middle C), never typed by
 * hand elsewhere on the page: every preset is played at this one pitch. */
function noteName(pitch: number) {
  const names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  return `${names[pitch % 12]}${Math.floor(pitch / 12) - 1}`;
}

/** The declared instrument's envelope shape, unnormalized peak-to-peak across
 * the probe's fixed duration - so a loud preset's plot looks loud and a
 * short percussion hit's release looks as sudden as it is. */
function EnvelopePlot({envelope, totalMs, noteOnMs}: {envelope: Preset['envelope']; totalMs: number; noteOnMs: number}) {
  const width = 160, height = 40;
  const scale = Math.max(envelope.peak, 1e-6);
  const points = envelope.curve.map((value, index) => {
    const x = (index / (envelope.curve.length - 1)) * width;
    const y = height - (Math.min(1, value / scale) * (height - 2) + 1);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  const noteOffX = (noteOnMs / totalMs) * width;
  return <svg className="instrument-plot instrument-envelope" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" aria-hidden="true">
    <line x1={noteOffX} y1="0" x2={noteOffX} y2={height} className="instrument-plot-marker"/>
    <polyline points={points} fill="none"/>
  </svg>;
}

/** The measured spectrum's 64 log-spaced bands, each bar normalized to this
 * preset's own loudest band - a shape, not a loudness comparison between
 * presets (levels below already cover that). */
function SpectrumPlot({bands}: {bands: {hz: number; db: number | null}[]}) {
  const width = 160, height = 40;
  const values = bands.map(b => b.db ?? -Infinity);
  const max = Math.max(...values.filter(Number.isFinite));
  const min = max - 48;
  const barWidth = width / bands.length;
  return <svg className="instrument-plot instrument-spectrum" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" aria-hidden="true">
    {bands.map((band, index) => {
      const level = band.db === null ? 0 : Math.max(0, Math.min(1, (band.db - min) / (max - min)));
      const barHeight = level * (height - 2);
      return <rect key={band.hz} x={index * barWidth} y={height - barHeight} width={Math.max(0.5, barWidth - 0.5)} height={barHeight}/>;
    })}
  </svg>;
}

function timbreLabel(t: ReturnType<typeof useT>, timbre: Timbre): string {
  switch (timbre.kind) {
    case 'sample': return t('Sample: {name}', {name: timbre.sample});
    case 'fm': return t('FM, algorithm {algorithm}, {operators} operators', {algorithm: timbre.algorithm, operators: timbre.operators});
    case 'wavetable': return t('Wavetable, {steps} steps', {steps: timbre.steps});
    case 'noise': return t('Noise');
    case 'sawtooth': return t('Sawtooth');
    case 'triangle': return t('Triangle');
    case 'pulse': return timbre.dutyPercent === null ? t('Pulse') : t('Pulse, {percent}% duty', {percent: timbre.dutyPercent});
    case 'tone': return t('Tone');
  }
}

function presetName(t: ReturnType<typeof useT>, preset: Preset): string {
  if (preset.role === 'perc') return t(DRUM_NAMES[preset.token ?? 'H']);
  const programs = preset.programs ?? [preset.program ?? 0];
  return programs.length > 1
    ? t('GM programs {first}-{last}', {first: programs[0], last: programs[programs.length - 1]})
    : t('GM program {first}', {first: programs[0]});
}

function tonalBalance(t: ReturnType<typeof useT>, flatness: number): string {
  return flatness < 0.05 ? t('tonal') : flatness > 0.3 ? t('noisy') : t('mixed');
}

export default function Instruments() {
  const t = useT();
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [loadingId, setLoadingId] = useState<string | null>(null);

  useEffect(() => {
    const audio = new Audio();
    audio.addEventListener('ended', () => setPlayingId(null));
    audio.addEventListener('error', () => { setPlayingId(null); setLoadingId(null); });
    audioRef.current = audio;
    return () => { audio.pause(); audio.removeAttribute('src'); audioRef.current = null; };
  }, []);

  const toggle = (preset: Preset) => {
    const audio = audioRef.current;
    if (!audio) return;
    if (playingId === preset.id) { audio.pause(); setPlayingId(null); return; }
    setLoadingId(preset.id);
    audio.src = preset.audio.file;
    audio.play().then(() => { setLoadingId(null); setPlayingId(preset.id); }).catch(() => { setLoadingId(null); setPlayingId(null); });
  };

  const byChip = useMemo(() => {
    const groups = new Map<ChipId, Map<Role, Preset[]>>();
    for (const preset of data.presets) {
      if (!groups.has(preset.chip)) groups.set(preset.chip, new Map());
      const chipGroup = groups.get(preset.chip)!;
      if (!chipGroup.has(preset.role)) chipGroup.set(preset.role, []);
      chipGroup.get(preset.role)!.push(preset);
    }
    return groups;
  }, []);

  return <><SiteHeader active="instruments"/><main className="demo-main about-main instruments-main">
    <span className="micro">{t("WHAT THE CHIP REALLY PLAYS")}</span>
    <h1>{t("The instrument catalogue.")}</h1>
    <p>{t("Every preset a user can pick - the lead, chord and bass programs and the percussion kit, for every chip - played as one fixed probe: pitch {note}, velocity {velocity}, held for {noteOn} ms of a {total} ms render. What differs below is only what the chip does with it: an envelope and a spectrum measured from the render itself, never from the instrument's declared parameters. The method is in ", {note: noteName(data.probe.pitch), velocity: data.probe.velocity, noteOn: data.probe.noteOnMs, total: data.probe.totalMs})}<code>scores/instruments/generate.mjs</code>{t(".")}</p>
    {CHIP_ORDER.filter(id => byChip.has(id)).map(chipId => {
      const machine = MACHINES.find(m => m.id === chipId);
      const roles = byChip.get(chipId)!;
      return <section className="chip-accuracy instrument-chip" key={chipId} aria-labelledby={`instruments-${chipId}`}>
        <div className="chip-accuracy-head">
          <h2 id={`instruments-${chipId}`}>{machine ? t(machine.name) : chipId} <span className="chip-accuracy-name">{machine?.chip}</span></h2>
        </div>
        {ROLE_ORDER.filter(role => roles.has(role)).map(role => <div className="instrument-role-group" key={role}>
          <h3 className={`instrument-role-heading instrument-role-${role}`}>{t(ROLE_NAMES[role])}</h3>
          <div className="instrument-cards">
            {roles.get(role)!.map(preset => {
              const playing = playingId === preset.id, loading = loadingId === preset.id;
              return <article className="instrument-card" key={preset.id}>
                <div className="instrument-card-head">
                  <h4>{presetName(t, preset)}</h4>
                  <PlayButton playing={playing} loading={loading} aria-label={t('Play {name} preview', {name: presetName(t, preset)})} onClick={() => toggle(preset)}/>
                </div>
                <p className="instrument-timbre">{timbreLabel(t, preset.timbre)}</p>
                <div className="instrument-plots">
                  <div><EnvelopePlot envelope={preset.envelope} totalMs={data.probe.totalMs} noteOnMs={data.probe.noteOnMs}/><span className="instrument-plot-label">{t("Envelope")}</span></div>
                  <div><SpectrumPlot bands={preset.spectrum.bands}/><span className="instrument-plot-label">{t("Spectrum")}</span></div>
                </div>
                <dl className="instrument-numbers">
                  <div><dt>{t("Attack")}</dt><dd>{t("{ms} ms", {ms: preset.envelope.attackMs})}</dd></div>
                  <div><dt>{t("Decay")}</dt><dd>{t("{ms} ms", {ms: preset.envelope.decayMs})}</dd></div>
                  <div><dt>{t("Release")}</dt><dd>{preset.envelope.releaseMeasured ? t("{ms} ms", {ms: preset.envelope.releaseMs}) : t("> {ms} ms", {ms: preset.envelope.releaseMs})}</dd></div>
                  <div><dt>{t("Peak / RMS")}</dt><dd>{preset.levels.samplePeakDbFS === null || preset.levels.rmsDbFS === null ? '—' : t("{peak} / {rms} dBFS", {peak: dbText(preset.levels.samplePeakDbFS), rms: dbText(preset.levels.rmsDbFS)})}</dd></div>
                  <div><dt>{t("Spectral centroid")}</dt><dd>{preset.spectrum.centroidHz === null ? '—' : t("{hz} Hz", {hz: Math.round(preset.spectrum.centroidHz)})}</dd></div>
                  <div><dt>{t("Noise vs. tone")}</dt><dd>{tonalBalance(t, preset.spectrum.flatness)}</dd></div>
                </dl>
              </article>;
            })}
          </div>
        </div>)}
      </section>;
    })}
    <p className="accuracy-regenerate">{t("Regenerated whenever the engine changes: ")}<code>pnpm instruments:build</code>{t(" measures every preset again and writes this page's data file and previews.")}</p>
  </main><SiteFooter/></>;
}
