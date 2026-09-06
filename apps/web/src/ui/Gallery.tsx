'use client';
import {useT} from '@/i18n/react';
import {RangeControl} from '@/ui/RangeControl';
import {useState} from 'react';
import {SiteHeader, SiteFooter, MachinePicker, PlayButton, Button, DisplayPanel} from '@/ui/components';
import type {ChipId} from '@/studio/document';
export default function Components() {
 const t = useT();
 const [tempo,setTempo]=useState(144);
 const [chip,setChip]=useState<ChipId>('snes');
 return <><SiteHeader active="lab"/><main className="demo-main catalog-grid"><div><span className="micro">{t("SHARED COMPONENTS")}</span><h1>{t("Same controls. Same rules.")}</h1><p>{t("Visual states used by the playground and listening lab. These examples do not play audio.")}</p></div><MachinePicker value={chip} onChange={setChip}/><div className="catalog-row"><PlayButton playing={false}/><PlayButton playing loading/><PlayButton playing={false} disabled/><Button>{t("Default action")}</Button><Button aria-pressed>{t("Selected")}</Button><Button disabled>{t("Unavailable")}</Button></div><div className="catalog-row"><RangeControl id="example-tempo" label={t("Tempo")} unit={t("BPM")} min={40} max={300} value={tempo} onChange={setTempo}/><RangeControl id="locked-tempo" label={t("Recording tempo")} unit={t("BPM")} min={40} max={300} value={96} disabled onChange={()=>{}}/></div><DisplayPanel><div className="screen-title"><span className="screen-kicker">{t("DISPLAY / ACTIVE")}</span><h2>{t("Listen closely.")}</h2></div></DisplayPanel><div className="catalog-row"><label className="ui-select">{t("SELECT")}<select><option>{t("Option one")}</option><option>{t("Option two")}</option></select></label><p className="ui-status" role="status">{t("Preparing the next sound. Playback continues.")}</p><p className="ui-status ui-error" role="alert">{t("Could not load this sound. Try again.")}</p></div><p>{t("Keyboard focus stays visible; selected states use text and contrast. Controls have a 44 px touch target. Reduced motion is respected.")}</p></main><SiteFooter/></>;
}
