'use client';
import {useT} from '@/i18n/react';
import {useRef} from 'react';
import {shapeScore, transposeBounds} from 'chipvoice';
import {RangeControl} from '../ui/RangeControl';
import type {SongDocument} from './document';

type Preview = {base: SongDocument['patterns']; transpose: number; drums: number};
export function CompositionControls({song, disabled, onEdit}: {song: SongDocument; disabled: boolean; onEdit: (song: SongDocument, group?: string) => void}) {
 const t = useT();
  // History owns the scores; weak keys let Undo restore the matching controls
  // without retaining old scores or putting preview metadata in publications.
  const previews = useRef(new WeakMap<SongDocument['patterns'], Preview>());
  const current = previews.current.get(song.patterns) ?? {base: song.patterns, transpose: 0, drums: 100};
  const hasDrums = current.base.some(pattern => /[KSHO]/.test(pattern.perc));
  const bounds = transposeBounds({...song, patterns: current.base});
  const change = (patch: Partial<Preview>, group?: string) => {
    const settings = {...current, ...patch};
    const next = shapeScore({...song, patterns: settings.base}, settings);
    previews.current.set(next.patterns, settings); onEdit(next, group);
  };
  const altered = current.transpose !== 0 || current.drums !== 100;
  return <section className="composition-controls" aria-label={t("Shape your loop")}>
    <div className="section-heading"><div><span className="micro">{t("MAKE IT YOURS")}</span><h2>{t("Find a different feel.")}</h2></div><button className="small-button" disabled={disabled || !altered} onClick={()=>change({transpose:0,drums:100})}>{t("Reset feel")}</button></div>
    <div className="composition-sliders">
      <div><RangeControl id="transpose" label={t("Transpose")} unit={t("st")} min={Math.min(0,bounds.min)} max={Math.max(0,bounds.max)} value={current.transpose} disabled={disabled || bounds.min>0 || bounds.max<0} onChange={(transpose,group)=>change({transpose},group)}/><p>{t("Lower or lift every pitched part. Drums keep their pitch.")}</p></div>
      <div><RangeControl id="drum-activity" label={t("Drum activity")} unit="%" min={0} max={100} value={hasDrums ? current.drums : 0} disabled={disabled || !hasDrums} onChange={(drums,group)=>change({drums},group)}/><p>{t(hasDrums ? 'Give the groove more space. 100% brings every hit back.' : 'No drums in this melody. Nothing is added automatically.')}</p></div>
    </div><p className="keyboard-hint">{t("Keep playing as you explore. Undo reverses a gesture; Reset feel restores this version.")}</p>
  </section>;
}
