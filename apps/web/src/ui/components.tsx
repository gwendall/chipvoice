'use client';
import {LanguageSelector, useT} from '@/i18n/react';
import type {ButtonHTMLAttributes, ReactNode} from 'react';
import Link from '@/i18n/react';
import {DEMO_MACHINES, type ChipId} from '../studio/document';

export function SiteHeader({active = 'playground'}: {active?: 'playground' | 'lab' | 'about'}) {
 const t = useT();
  return <header className="site-header"><Link href="/" className="wordmark" aria-label={t("chipvoice home")}><span className="brand-mark" aria-hidden="true"><i/><i/><i/><i/></span>{t("chipvoice")}</Link><span className="header-tag">{t("OLD CHIPS. NEW TRICKS.")}</span><nav aria-label={t("Project")}><Link href="/" aria-current={active === 'playground' ? 'page' : undefined}>{t("Playground")}</Link><Link href="/lab" aria-current={active === 'lab' ? 'page' : undefined}>{t("Listening lab")}</Link><Link href="/about" aria-current={active === 'about' ? 'page' : undefined}>{t("About")}</Link></nav><LanguageSelector/></header>;
}
export function SiteFooter() {
 const t = useT();
  return <footer className="site-footer"><div className="footer-credit"><a href="https://gwendall.com">{t("Made by gwendall ")}<span aria-hidden="true">↗</span></a><span>{t("chipvoice · A love letter to little sound chips.")}</span></div><nav aria-label={t("Footer")}><Link href="/lab">{t("Listening lab")}</Link><Link href="/about#credits">{t("Credits")}</Link><a href="https://github.com/gwendall/chipvoice">{t("GitHub ↗")}</a><a href="/skill.md">{t("For agents ↗")}</a></nav></footer>;
}
export function MachinePicker({value, onChange, disabled = false}: {value: ChipId; onChange: (id: ChipId) => void; disabled?: boolean}) {
 const t = useT();
  return <div className="machines" aria-label={t("Sound machine")}>{DEMO_MACHINES.map(machine => <button key={machine.id} disabled={disabled} aria-label={t(machine.name)} title={`${t(machine.name)} · ${machine.chip}`} aria-pressed={value === machine.id} onClick={() => onChange(machine.id)}><img className={`machine-logo machine-logo-${machine.id}`} src={machine.logo} alt="" width="160" height="48" draggable={false}/></button>)}</div>;
}
export function PlayButton({playing, loading = false, shortcut = false, pause = false, ...props}: ButtonHTMLAttributes<HTMLButtonElement> & {playing: boolean; loading?: boolean; shortcut?: boolean; pause?: boolean}) {
 const t = useT();
  return <button {...props} className={`play-button ${playing ? 'playing' : ''} ${props.className ?? ''}`} aria-label={t(playing ? (pause ? 'Pause' : 'Stop') : 'Play')} aria-busy={loading || undefined}><span aria-hidden="true">{t(playing ? (pause ? 'Ⅱ' : '■') : '▶')}</span>{t(playing ? (pause ? 'Pause' : 'Stop') : 'Play')}{shortcut && <kbd>{t("space")}</kbd>}</button>;
}
export function Button({className = '', ...props}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button {...props} className={`small-button ${className}`}/>;
}
export function DisplayPanel({children, className = ''}: {children: ReactNode; className?: string}) {
  return <div className={`screen-bezel ${className}`}>{children}</div>;
}
