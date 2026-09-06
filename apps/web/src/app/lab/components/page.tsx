'use client';
import {useState} from 'react';
import {SiteHeader, SiteFooter, MachinePicker, PlayButton, Button, DisplayPanel} from '@/ui/components';
import type {ChipId} from '@/studio/document';
export default function Components() {
 const [chip,setChip]=useState<ChipId>('snes');
 return <><SiteHeader active="lab"/><main className="demo-main catalog-grid"><div><span className="micro">SHARED COMPONENTS</span><h1>Same controls. Same rules.</h1><p>Visual states used by the playground and listening lab. These examples do not play audio.</p></div><MachinePicker value={chip} onChange={setChip}/><div className="catalog-row"><PlayButton playing={false}/><PlayButton playing loading/><PlayButton playing={false} disabled/><Button>Default action</Button><Button aria-pressed>Selected</Button><Button disabled>Unavailable</Button></div><DisplayPanel><div className="screen-title"><span className="screen-kicker">DISPLAY / ACTIVE</span><h2>Listen closely.</h2></div></DisplayPanel><div className="catalog-row"><label className="ui-select">SELECT<select><option>Option one</option><option>Option two</option></select></label><p className="ui-status" role="status">Preparing the next sound. Playback continues.</p><p className="ui-status ui-error" role="alert">Could not load this sound. Try again.</p></div><p>Keyboard focus stays visible; selected states use text and contrast. Controls have a 44 px touch target. Reduced motion is respected.</p></main><SiteFooter/></>;
}
