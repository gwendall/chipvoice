'use client';
import {useT} from '@/i18n/react';
import { useState } from 'react';
import { varyScore, type Role, type VariationOptions } from 'chipvoice';
import { ROLES, ROLE_NAMES, type SongDocument } from './document';
import { measure } from './metrics';

export function Variations({ song, disabled, onEdit, onNotice }: {
  song: SongDocument; disabled: boolean; onEdit: (song: SongDocument) => void; onNotice: (message: string) => void;
}) {
 const t = useT();
  const [locked, setLocked] = useState<Role[]>(['bass', 'chord']);
  const vary = (kind: VariationOptions['kind']) => {
    const seed = crypto.getRandomValues(new Uint32Array(1))[0];
    const next = varyScore(song, { kind, locked, seed });
    if (next === song) { onNotice('No change for these parts. Add melody notes or unlock a role to vary.'); return; }
    onEdit(next); measure('variation'); onNotice('Variation ready. Undo brings back your previous loop.');
  };
  return <section className="variations" aria-label={t("Musical variations")}>
    <div className="section-heading"><div><span className="micro">{t("KEEP WHAT YOU LOVE")}</span><h2>{t("A familiar tune. A new turn.")}</h2></div><p>{t("Lock a part, then try a small change.")}</p></div>
    <div className="variation-locks">{ROLES.map(role => <button key={role} className="small-button" disabled={disabled} aria-label={t("Lock {v0}",{v0:t(ROLE_NAMES[role])})} aria-pressed={locked.includes(role)} onClick={() => setLocked(previous => previous.includes(role) ? previous.filter(r => r !== role) : [...previous, role])}><span aria-hidden="true">{(locked.includes(role)?t('■'):t('□'))}</span> {t(ROLE_NAMES[role])}</button>)}</div>
    <div className="variation-actions"><button className="small-button" disabled={disabled || locked.includes('lead')} onClick={() => vary('melody')}>{t("Vary melody ↗")}</button><button className="small-button" disabled={disabled || locked.includes('perc')} onClick={() => vary('drums')}>{t("Vary drums ↗")}</button><button className="small-button" disabled={disabled || locked.length === ROLES.length} onClick={() => vary('timbres')}>{t("Vary timbres ↗")}</button></div>
    <p className="keyboard-hint">{t("Melody keeps your rhythm. Drums try a composed groove. Locked parts stay exactly as they are.")}</p>
  </section>;
}
