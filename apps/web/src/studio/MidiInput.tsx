'use client';
import {useT} from '@/i18n/react';
import { useEffect, useRef, useState } from 'react';
import type { Role } from 'chipvoice';
import { midiTap } from './midi';

export function MidiInput({ role, onNote }: { role: Role; onNote: (role: Role, note: string) => void }) {
 const t = useT();
  const [available, setAvailable] = useState(false);
  const [access, setAccess] = useState<MIDIAccess | null>(null);
  const [ports, setPorts] = useState<MIDIInput[]>([]);
  const [selected, setSelected] = useState('');
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState('');
  const request = useRef(0);
  const latest = useRef({ role, onNote }); latest.current = { role, onNote };
  useEffect(() => { setAvailable(typeof navigator.requestMIDIAccess === 'function'); return () => { request.current++; }; }, []);
  useEffect(() => {
    if (!access) return;
    const update = () => {
      const connected = [...access.inputs.values()].filter(port => port.state === 'connected');
      setPorts(connected);
      setSelected(previous => connected.some(port => port.id === previous) ? previous : connected[0]?.id ?? '');
    };
    access.addEventListener('statechange', update); update();
    return () => access.removeEventListener('statechange', update);
  }, [access]);
  useEffect(() => {
    const port = access?.inputs.get(selected);
    if (!port) return;
    const receive = (event: MIDIMessageEvent) => {
      if (!event.data) return;
      const tap = midiTap(event.data, latest.current.role);
      if (tap) latest.current.onNote(tap.role, tap.note);
    };
    port.addEventListener('midimessage', receive);
    let active = true;
    void port.open().catch(() => { if (active) setMessage('Could not open this MIDI input. Try reconnecting it.'); });
    return () => { active = false; port.removeEventListener('midimessage', receive); void port.close().catch(() => {}); };
  }, [access, selected]);
  const connect = async () => {
    const token = ++request.current;
    setPending(true); setMessage('');
    try {
      const result = await navigator.requestMIDIAccess({ sysex: false });
      if (request.current === token) setAccess(result);
    } catch { if (request.current === token) setMessage('MIDI access was not granted. You can keep using the keys and pads.'); }
    finally { if (request.current === token) setPending(false); }
  };
  if (!available) return <p className="keyboard-hint">{t("MIDI input is unavailable in this browser. The keys and pads work without it.")}</p>;
  return <div className="midi-input">
    {access ? <><label htmlFor="midi-port">{t("MIDI input")}</label><select id="midi-port" value={selected} onChange={e => setSelected(e.target.value)}>{ports.length ? ports.map(port => <option key={port.id} value={port.id}>{port.name || t('MIDI keyboard')}</option>) : <option value="">{t("Connect a keyboard or drum pad")}</option>}</select><button className="small-button" onClick={() => { request.current++; setAccess(null); setPorts([]); setSelected(''); }}>{t("Disconnect MIDI")}</button></> : <button className="small-button" disabled={pending} onClick={() => void connect()}>{(pending?t('Connecting MIDI…'):t('Connect MIDI'))}</button>}
    <span className="keyboard-hint" role="status">{t(message || (access ? 'Note presses play the selected role. Channel 10 plays drums. Record captures taps.' : 'Optional keyboard or drum pad. Permission is requested when you connect.'))}</span>
  </div>;
}
