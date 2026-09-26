import type { SongInput as Input } from '@/lib/schema';
import type { Pattern, Role } from 'chipvoice';

// Pure display/lookup data, kept apart from `document.ts` on purpose: this
// file must never gain a runtime import of `chipvoice`. `PersistentPlayer`
// (mounted on every route) and the shared `SiteHeader`/`MachinePicker` UI
// (rendered on nearly every page) only need this metadata, and importing it
// from `document.ts` used to drag the whole package - all five chip engines
// and their inlined AudioWorklet sources - into every page's bundle, since
// `document.ts` also imports `arrange`/`validateSong` at module scope.
export type ChipId = Input['chip'];
export const ROLES: Role[] = ['lead', 'chord', 'bass', 'perc'];
export const ROLE_NAMES: Record<Role, string> = { lead: 'Melody', chord: 'Chords', bass: 'Bass', perc: 'Drums' };
export const MACHINES: { id: ChipId; name: string; chip: string; year: string; logo: string }[] = [
  { id: '2a03', logo: '/machines/famicom.svg', name: 'Famicom', chip: 'Ricoh 2A03', year: '1983' },
  { id: 'dmg', logo: '/machines/game-boy.svg', name: 'Game Boy', chip: 'DMG APU', year: '1989' },
  { id: 'md', logo: '/machines/mega-drive-jp.svg', name: 'Mega Drive', chip: 'YM2612 + SN76489', year: '1988' },
  { id: 'snes', logo: '/machines/super-famicom.svg', name: 'Super Famicom', chip: 'S-DSP', year: '1990' },
  { id: 'c64', logo: '/machines/c64.svg', name: 'C64', chip: 'MOS 6581 SID', year: '1982' },
];
// Presentation only: retain SID support for existing drafts, shares and the SDK.
export const DEMO_MACHINES = MACHINES.filter(machine => machine.id !== 'c64');
export const tokens = (line: string) => line.trim().split(/\s+/).filter(Boolean);
export const lengthOf = (pattern: Pattern) => tokens(pattern.bass).length;
