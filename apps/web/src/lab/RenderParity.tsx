'use client';
import {useEffect, useRef, useState} from 'react';
import {useErrorText, useT} from '@/i18n/react';
import {SiteHeader, SiteFooter, Button} from '../ui/components';
import type {PerformancePlan, ChipDefinition} from 'chipvoice';
import './render-parity.css';

/**
 * MIX-14's one-minute manual check: renders the same fixed input set the
 * Node/Playwright sheet (`docs/RENDER-PARITY.md`) uses, in whatever browser
 * opened this page, and compares its hashes against the Node reference the
 * fixture was built with. Chromium, Firefox and WebKit already run this
 * automatically (`pnpm render-parity:check`/`:sheet`); this page exists for
 * what nothing but a person can do - a real phone, and real Safari.
 *
 * `planFromJSON` below is a copy of `scores/render-parity/serialize.mjs`
 * (isomorphic on purpose: JSON, `DataView`, `btoa` and `atob` only - this
 * component cannot import that file, which lives outside `apps/web/src`).
 * Keep the two in sync by hand; `scores/render-parity/harness.html` keeps a
 * third copy for the same reason, for the Playwright side of the same
 * comparison.
 */

type FixtureInput = {
  id: string;
  kind: string;
  chip: string;
  title: string;
  seconds: number;
  plan: {chip: string; seconds: number; events: string; memory: {address: number; bytes: string}[]};
  node: {sha256: string; peak: number};
};
type Fixture = {version: number; revision: string; engineSha256: string; nodeVersion: string; sampleRate: number; inputs: FixtureInput[]};
type RowState = 'pending' | 'running' | 'match' | 'mismatch' | 'error';
type Row = {input: FixtureInput; state: RowState; sha256?: string; error?: string};

// 9 bytes/event, base64-encoded: a 4-byte `at` (uint32 LE), a 4-byte `addr`
// (uint32) and a 1-byte `value` (uint8). See serialize.mjs's `packEvents` for
// why - a JSON number array costs a byte per digit and comma per field.
function unpackEvents(text: string) {
  const bytes = base64ToBytes(text);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const events = new Array(bytes.length / 9);
  for (let i = 0; i < events.length; i++) events[i] = {at: view.getUint32(i * 9, true), addr: view.getUint32(i * 9 + 4, true), value: view.getUint8(i * 9 + 8)};
  return events;
}
function base64ToBytes(text: string) {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
function planFromJSON(json: FixtureInput['plan']): PerformancePlan {
  return {
    chip: json.chip,
    seconds: json.seconds,
    events: unpackEvents(json.events),
    memory: json.memory.map(block => ({address: block.address, bytes: base64ToBytes(block.bytes)})),
    // renderPerformance never reads these three; the fixture never carries them.
    loopStartSeconds: 0, notes: [], losses: [],
  } as unknown as PerformancePlan;
}
function pcmBytes(left: Float32Array, right: Float32Array | null) {
  const bytes = new Uint8Array(left.byteLength + (right ? right.byteLength : 0));
  bytes.set(new Uint8Array(left.buffer, left.byteOffset, left.byteLength), 0);
  if (right) bytes.set(new Uint8Array(right.buffer, right.byteOffset, right.byteLength), left.byteLength);
  return bytes;
}
async function sha256Hex(bytes: Uint8Array) {
  const digest = await crypto.subtle.digest('SHA-256', bytes as BufferSource);
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}

export default function RenderParity() {
  const t = useT();
  const errorText = useErrorText();
  const [fixture, setFixture] = useState<Fixture | null>(null);
  const [fixtureError, setFixtureError] = useState('');
  const [rows, setRows] = useState<Row[]>([]);
  const [running, setRunning] = useState(false);
  const generation = useRef(0);

  useEffect(() => {
    const abort = new AbortController();
    fetch('/render-parity-data/inputs.json', {signal: abort.signal})
      .then(response => { if (!response.ok) throw new Error('The render-parity fixture could not load. Reload to try again.'); return response.json(); })
      .then((data: Fixture) => setFixture(data))
      .catch(error => { if (!abort.signal.aborted) setFixtureError(error.message); });
    return () => abort.abort();
  }, []);

  const run = async () => {
    if (!fixture || running) return;
    const ticket = ++generation.current;
    setRunning(true);
    setRows(fixture.inputs.map(input => ({input, state: 'pending'})));
    const {renderPerformance, nesChip, gbChip, mdChip, snesChip, c64Chip} = await import('chipvoice');
    const chips: Record<string, ChipDefinition> = {'2a03': nesChip, dmg: gbChip, md: mdChip, snes: snesChip, c64: c64Chip};
    for (let i = 0; i < fixture.inputs.length; i++) {
      if (ticket !== generation.current) return;
      const input = fixture.inputs[i];
      setRows(current => current.map((row, index) => index === i ? {...row, state: 'running'} : row));
      // One render at a time, yielding to the browser between rows: a phone's
      // main thread stays responsive and the page shows progress instead of
      // freezing until every input has rendered.
      await new Promise(resolve => requestAnimationFrame(resolve));
      try {
        const chip = chips[input.chip];
        if (!chip) throw new Error(`unknown chip: ${input.chip}`);
        const audio = renderPerformance(planFromJSON(input.plan), chip);
        const sha256 = await sha256Hex(pcmBytes(audio.left, audio.right));
        if (ticket !== generation.current) return;
        const state: RowState = sha256 === input.node.sha256 ? 'match' : 'mismatch';
        setRows(current => current.map((row, index) => index === i ? {...row, state, sha256} : row));
      } catch (error) {
        if (ticket !== generation.current) return;
        setRows(current => current.map((row, index) => index === i ? {...row, state: 'error', error: error instanceof Error ? error.message : String(error)} : row));
      }
    }
    if (ticket === generation.current) setRunning(false);
  };

  useEffect(() => { if (fixture) void run(); }, [fixture]);

  const done = rows.length > 0 && rows.every(row => row.state === 'match' || row.state === 'mismatch' || row.state === 'error');
  const mismatches = rows.filter(row => row.state === 'mismatch' || row.state === 'error').length;
  const userAgent = typeof navigator === 'object' ? navigator.userAgent : '';

  return <><SiteHeader active="lab"/><main className="demo-main render-parity-main">
    <div className="lab-intro">
      <div><span className="micro">{t("MIX-14")}</span><h1>{t("Render parity checker")}</h1>
        <p>{t("Renders the same fixed inputs Node and the automated browser matrix use, right here in this browser, and compares the result byte for byte against the Node reference. Chromium, Firefox and WebKit already pass this automatically; this page is for what only a person can check: a real phone, and real Safari.")}</p></div>
    </div>
    <p className="render-parity-howto"><strong>{t("On a phone: ")}</strong>{t("open this page, wait for every row below to finish (about a minute), and check whether every row says Match. If anything says Mismatch, it is worth reporting together with the device, OS and browser version shown below.")}</p>
    {fixtureError && <p className="ui-status ui-error" role="alert">{errorText(fixtureError)}</p>}
    {!fixture && !fixtureError && <p role="status">{t("Loading the fixed input set…")}</p>}
    {fixture && <>
      <div className="render-parity-summary">
        <span>{t("Node reference: ")}{fixture.nodeVersion} · {fixture.revision.slice(0, 7)}</span>
        {done && <span className={mismatches === 0 ? 'render-parity-pass' : 'render-parity-fail'}>{mismatches === 0 ? t("{count} of {total} match", {count: rows.length, total: rows.length}) : t("{count} of {total} mismatch", {count: mismatches, total: rows.length})}</span>}
        <Button onClick={run} disabled={running}>{running ? t("Rendering…") : t("Run again")}</Button>
      </div>
      <div className="render-parity-table-wrap"><table><thead><tr><th>{t("Input")}</th><th>{t("Chip")}</th><th>{t("Seconds")}</th><th>{t("Result")}</th></tr></thead><tbody>
        {rows.map(row => <tr key={row.input.id}><th>{row.input.id}</th><td>{row.input.chip}</td><td>{row.input.seconds.toFixed(1)}</td>
          <td className={`render-parity-cell-${row.state}`}>
            {row.state === 'pending' && t("Waiting…")}
            {row.state === 'running' && t("Rendering…")}
            {row.state === 'match' && t("Match")}
            {row.state === 'mismatch' && t("Mismatch")}
            {row.state === 'error' && errorText(row.error ?? '')}
          </td>
        </tr>)}
      </tbody></table></div>
      <p className="render-parity-fine">{t("This device: ")}{userAgent}</p>
      <p className="render-parity-fine">{t("Hashes cover the raw PCM samples, not a 16-bit WAV file, so a difference far too small to hear still shows as a mismatch here.")}</p>
    </>}
  </main><SiteFooter/></>;
}
