import type {ButtonHTMLAttributes, ReactNode} from 'react';
import Link from 'next/link';
import {MACHINES, type ChipId} from '../studio/document';

export function SiteHeader({active = 'playground'}: {active?: 'playground' | 'lab'}) {
  return <header className="site-header"><Link href="/" className="wordmark" aria-label="chipvoice home"><span className="brand-mark" aria-hidden="true"><i/><i/><i/><i/></span>chipvoice</Link><span className="header-tag">OLD CHIPS. NEW TRICKS.</span><nav aria-label="Project"><Link href="/" aria-current={active === 'playground' ? 'page' : undefined}>Playground</Link><Link href="/lab" aria-current={active === 'lab' ? 'page' : undefined}>Listening lab</Link><a href="https://github.com/gwendall/chipvoice#readme">Docs ↗</a></nav></header>;
}
export function SiteFooter() {
  return <footer className="site-footer"><span>chipvoice · A love letter to little sound chips.</span><div><Link href="/lab">Listening lab</Link><a href="https://github.com/HVR88/Monochrome-Gaming-Logos">Console logos ↗</a><a href="https://github.com/gwendall/chipvoice">GitHub ↗</a><a href="/skill.md">For agents ↗</a></div></footer>;
}
export function MachinePicker({value, onChange, disabled = false}: {value: ChipId; onChange: (id: ChipId) => void; disabled?: boolean}) {
  return <div className="machines" aria-label="Sound machine">{MACHINES.map(machine => <button key={machine.id} disabled={disabled} aria-pressed={value === machine.id} onClick={() => onChange(machine.id)}><span className="machine-logo" style={{maskImage: `url(${machine.logo})`, WebkitMaskImage: `url(${machine.logo})`}} aria-hidden="true"/><strong><span className="machine-led"/>{machine.name}</strong></button>)}</div>;
}
export function PlayButton({playing, loading = false, shortcut = false, ...props}: ButtonHTMLAttributes<HTMLButtonElement> & {playing: boolean; loading?: boolean; shortcut?: boolean}) {
  return <button {...props} className={`play-button ${playing ? 'playing' : ''} ${props.className ?? ''}`} aria-label={playing ? 'Stop' : 'Play'} aria-busy={loading || undefined}><span aria-hidden="true">{playing ? '■' : '▶'}</span>{playing ? 'Stop' : 'Play'}{shortcut && <kbd>space</kbd>}</button>;
}
export function Button({className = '', ...props}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button {...props} className={`small-button ${className}`}/>;
}
export function DisplayPanel({children, className = ''}: {children: ReactNode; className?: string}) {
  return <div className={`screen-bezel ${className}`}>{children}</div>;
}
