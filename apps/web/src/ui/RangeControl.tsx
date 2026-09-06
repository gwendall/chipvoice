'use client';
import {useT} from '@/i18n/react';
import {useEffect, useId, useRef, useState} from 'react';

/** Native slider and editable number, with one history group per gesture. */
export function RangeControl({id, label, unit, min, max, value, disabled = false, onChange}: {
  id: string; label: string; unit: string; min: number; max: number; value: number;
  disabled?: boolean; onChange: (value: number, group: string) => void;
}) {
 const t = useT();
  const identity = useId(), sequence = useRef(0), group = useRef<string | null>(null);
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  const begin = () => { group.current ??= `${identity}:${++sequence.current}`; };
  const end = () => { group.current = null; };
  const change = (next: number) => {
    begin();
    if (next !== value) onChange(next, group.current!);
  };
  const commit = () => {
    const parsed = draft.trim() === '' ? value : Number(draft);
    const next = Number.isFinite(parsed) ? Math.max(min, Math.min(max, Math.round(parsed))) : value;
    setDraft(String(next)); change(next); end();
  };
  return <div className="range-control" aria-disabled={disabled || undefined}>
    <label htmlFor={`${id}-slider`}>{t(label)}</label>
    <div className="range-control-fields">
      <div className="range-control-track">
        <input id={`${id}-slider`} type="range" aria-label={t("{v0} slider",{v0:t(label)})} aria-valuetext={t("{v0} {v1}",{v0:value,v1:t(unit)})} min={min} max={max} step={1} value={value} disabled={disabled}
          onPointerDown={begin} onPointerUp={end} onPointerCancel={end} onBlur={end} onChange={event => change(Number(event.target.value))}/>
        <div className="range-control-bounds" aria-hidden="true"><span>{min}</span><span>{max}</span></div>
      </div>
      <div className="range-control-number"><input id={id} type="number" aria-label={t(label)} min={min} max={max} step={1} value={draft} disabled={disabled}
        onFocus={event => { begin(); event.target.select(); }} onBlur={commit} onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); }}
        onChange={event => { const text = event.target.value; setDraft(text); const next = Number(text); if (text.trim() !== '' && Number.isInteger(next) && next >= min && next <= max) change(next); }}/><span>{t(unit)}</span></div>
    </div>
  </div>;
}
