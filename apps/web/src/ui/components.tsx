import type {ButtonHTMLAttributes, ReactNode} from 'react';
import Link from 'next/link';
import {DEMO_MACHINES, type ChipId} from '../studio/document';

export function SiteHeader({active = 'playground'}: {active?: 'playground' | 'lab' | 'about'}) {
  return <header className="site-header"><Link href="/" className="wordmark" aria-label="chipvoice home"><span className="brand-mark" aria-hidden="true"><i/><i/><i/><i/></span>chipvoice</Link><span className="header-tag">OLD CHIPS. NEW TRICKS.</span><nav aria-label="Project"><Link href="/" aria-current={active === 'playground' ? 'page' : undefined}>Playground</Link><Link href="/lab" aria-current={active === 'lab' ? 'page' : undefined}>Listening lab</Link><Link href="/about" aria-current={active === 'about' ? 'page' : undefined}>About</Link></nav></header>;
}
export function SiteFooter() {
  return <footer className="site-footer"><div className="footer-credit"><a href="https://gwendall.com">Made by gwendall <span aria-hidden="true">↗</span></a><span>chipvoice · A love letter to little sound chips.</span></div><nav aria-label="Footer"><Link href="/lab">Listening lab</Link><Link href="/about#credits">Credits</Link><a href="https://github.com/gwendall/chipvoice">GitHub ↗</a><a href="/skill.md">For agents ↗</a></nav></footer>;
}
export function MachinePicker({value, onChange, disabled = false}: {value: ChipId; onChange: (id: ChipId) => void; disabled?: boolean}) {
  return <div className="machines" aria-label="Sound machine">{DEMO_MACHINES.map(machine => <button key={machine.id} disabled={disabled} aria-label={machine.name} title={`${machine.name} · ${machine.chip}`} aria-pressed={value === machine.id} onClick={() => onChange(machine.id)}><img className={`machine-logo machine-logo-${machine.id}`} src={machine.logo} alt="" width="160" height="48" draggable={false}/></button>)}</div>;
}
export function PlayButton({playing, loading = false, shortcut = false, pause = false, ...props}: ButtonHTMLAttributes<HTMLButtonElement> & {playing: boolean; loading?: boolean; shortcut?: boolean; pause?: boolean}) {
  return <button {...props} className={`play-button ${playing ? 'playing' : ''} ${props.className ?? ''}`} aria-label={playing ? (pause ? 'Pause' : 'Stop') : 'Play'} aria-busy={loading || undefined}><span aria-hidden="true">{playing ? (pause ? 'Ⅱ' : '■') : '▶'}</span>{playing ? (pause ? 'Pause' : 'Stop') : 'Play'}{shortcut && <kbd>space</kbd>}</button>;
}
export function Button({className = '', ...props}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button {...props} className={`small-button ${className}`}/>;
}
export function DisplayPanel({children, className = ''}: {children: ReactNode; className?: string}) {
  return <div className={`screen-bezel ${className}`}>{children}</div>;
}
