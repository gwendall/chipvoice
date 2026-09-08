'use client';
import {useSession} from '@/auth/useSession';
import {LanguageSelector, useT} from '@/i18n/react';
import type {ButtonHTMLAttributes, ReactNode} from 'react';
import Link from '@/i18n/react';
import {DEMO_MACHINES, type ChipId} from '../studio/document';

export function SiteHeader({active = 'playground'}: {active?: 'playground' | 'lab' | 'about' | 'create' | 'explore' | 'docs' | 'signin'}) {
 const t = useT(), { status: session } = useSession();
  return <header className="site-header"><Link href="/" className="wordmark" aria-label={t("chipvoice home")}><span className="brand-mark" aria-hidden="true"><i/><i/><i/><i/></span>{t("chipvoice")}</Link><span className="header-tag">{t("OLD CHIPS. NEW TRICKS.")}</span><nav aria-label={t("Project")}><Link href="/" aria-current={active === 'playground' ? 'page' : undefined}>{t("Playground")}</Link><Link href="/create" aria-current={active==='create'?'page':undefined}>{t("Create")}</Link><Link href="/explore" aria-current={active==='explore'?'page':undefined}>{t("Explore")}</Link><Link href="/docs" aria-current={active==='docs'?'page':undefined}>{t("API")}</Link><Link href={session === "signed-in" ? "/library" : active === "create" ? "/signin?next=%2Fcreate%3Fcompose%3D1%23prompt" : "/signin"} aria-current={active === "signin" ? "page" : undefined}>{t(session === "signed-in" ? "Your library" : "Sign in")}</Link></nav><LanguageSelector/></header>;
}
export function SiteFooter() {
 const t = useT();
  return <footer className="site-footer"><div className="footer-credit"><a href="https://gwendall.com">{t("Made by gwendall ")}<span aria-hidden="true">↗</span></a><span>{t("chipvoice · A love letter to little sound chips.")}</span></div><nav aria-label={t("Footer")}><Link href="/lab">{t("Listening lab")}</Link><Link href="/about">{t("About")}</Link><Link href="/about#credits">{t("Credits")}</Link><a href="https://github.com/gwendall/chipvoice">{t("GitHub ↗")}</a><a href="/skill.md">{t("For agents ↗")}</a></nav></footer>;
}
export function MachinePicker({value, onChange, disabled = false}: {value: ChipId; onChange: (id: ChipId) => void; disabled?: boolean}) {
 const t = useT();
  return <div className="machines" aria-label={t("Sound machine")}>{DEMO_MACHINES.map(machine => <button key={machine.id} disabled={disabled} aria-label={t(machine.name)} title={`${t(machine.name)} · ${machine.chip}`} aria-pressed={value === machine.id} onClick={() => onChange(machine.id)}><img className={`machine-logo machine-logo-${machine.id}`} src={machine.logo} alt="" width="160" height="48" draggable={false}/></button>)}</div>;
}
export function PlayButton({playing, loading = false, shortcut = false, pause = false, ...props}: ButtonHTMLAttributes<HTMLButtonElement> & {playing: boolean; loading?: boolean; shortcut?: boolean; pause?: boolean}) {
 const t = useT();
  return <button {...props} className={`play-button ${playing ? 'playing' : ''} ${props.className ?? ''}`} aria-label={(playing?t((pause ? 'Pause' : 'Stop')):t('Play'))} aria-busy={loading || undefined}><span aria-hidden="true">{(playing?t((pause ? 'Ⅱ' : '■')):t('▶'))}</span>{(playing?t((pause ? 'Pause' : 'Stop')):t('Play'))}{shortcut && <kbd>{t("space")}</kbd>}</button>;
}
export function Button({className = '', ...props}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button {...props} className={`small-button ${className}`}/>;
}
export function DisplayPanel({children, className = ''}: {children: ReactNode; className?: string}) {
  return <div className={`screen-bezel ${className}`}>{children}</div>;
}
