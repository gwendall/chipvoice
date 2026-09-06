'use client';
import { useCallback, useEffect, useReducer, useState } from 'react';
import { decodeDocument, readDocument, type SongDocument } from './document';
import { DEFAULT_PRESET } from './presets';
const STORAGE = 'chipvoice.draft.v1';
type Update = SongDocument | ((song: SongDocument) => SongDocument);
type Snapshot = { song: SongDocument; builtinTitle: boolean };
type State = Snapshot & { past: Snapshot[]; future: Snapshot[]; group?: string };
type Action = { type: 'edit'; song: Update; group?: string; builtinTitle?: boolean } | { type: 'restore'; song: SongDocument } | { type: 'undo' | 'redo' };
const snapshot = ({song, builtinTitle}: Snapshot): Snapshot => ({song, builtinTitle});
function reducer(state: State, action: Action): State {
  if (action.type === 'restore') return { past: [], song: action.song, builtinTitle: false, future: [] };
  if (action.type === 'edit') {
    const song = typeof action.song === 'function' ? action.song(state.song) : action.song;
    const builtinTitle = action.builtinTitle ?? (state.builtinTitle && song.title === state.song.title);
    if (builtinTitle === state.builtinTitle && (song === state.song || JSON.stringify(state.song) === JSON.stringify(song))) return state;
    const continued = action.group !== undefined && action.group === state.group;
    return { past: continued ? state.past : [...state.past.slice(-49), snapshot(state)], song, builtinTitle, future: [], group: action.group };
  }
  if (action.type === 'undo' && state.past.length) return { past: state.past.slice(0, -1), ...state.past.at(-1)!, future: [snapshot(state), ...state.future] };
  if (action.type === 'redo' && state.future.length) return { past: [...state.past, snapshot(state)], ...state.future[0], future: state.future.slice(1) };
  return state;
}
export function useSongDocument(initial?: SongDocument, sourceId?: string) {
  const storageKey = sourceId ? `${STORAGE}:${sourceId}` : STORAGE;
  const [state, dispatch] = useReducer(reducer, { past: [], song: initial ?? DEFAULT_PRESET.song, builtinTitle: !initial, future: [] });
  const [ready, setReady] = useState(false);
  const [recovered, setRecovered] = useState(false);
  useEffect(() => {
    try {
      {
        const hash = initial ? '' : location.hash.slice(1);
        const draft = hash ? decodeDocument(hash) : readDocument(JSON.parse(localStorage.getItem(storageKey) ?? 'null'));
        if (draft) { dispatch({ type: 'restore', song: draft }); setRecovered(!hash); }
      }
    } catch { /* Storage can be unavailable; the instrument still works. */ }
    setReady(true);
  }, [initial, storageKey]);
  useEffect(() => {
    if (ready) { try { localStorage.setItem(storageKey, JSON.stringify(state.song)); } catch {} }
  }, [state.song, ready, storageKey]);
  const edit = useCallback((song: Update, group?: string) => dispatch({ type: 'edit', song, group }), []);
  const loadPreset = useCallback((song: SongDocument) => dispatch({ type: 'edit', song, builtinTitle: true }), []);
  const undo = useCallback(() => dispatch({ type: 'undo' }), []);
  const redo = useCallback(() => dispatch({ type: 'redo' }), []);
  return { ...state, edit, loadPreset, undo, redo, canUndo: !!state.past.length, canRedo: !!state.future.length, ready, recovered };
}
