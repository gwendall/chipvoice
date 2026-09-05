'use client';
import { useCallback, useEffect, useReducer, useState } from 'react';
import { decodeDocument, readDocument, type SongDocument } from './document';
import { PRESETS } from './presets';
const STORAGE = 'chipvoice.draft.v1';
type State = { past: SongDocument[]; song: SongDocument; future: SongDocument[] };
type Action = { type: 'edit'; song: SongDocument } | { type: 'restore'; song: SongDocument } | { type: 'undo' | 'redo' };
function reducer(state: State, action: Action): State {
  if (action.type === 'restore') return { past: [], song: action.song, future: [] };
  if (action.type === 'edit') {
    if (JSON.stringify(state.song) === JSON.stringify(action.song)) return state;
    return { past: [...state.past.slice(-49), state.song], song: action.song, future: [] };
  }
  if (action.type === 'undo' && state.past.length) return { past: state.past.slice(0, -1), song: state.past.at(-1)!, future: [state.song, ...state.future] };
  if (action.type === 'redo' && state.future.length) return { past: [...state.past, state.song], song: state.future[0], future: state.future.slice(1) };
  return state;
}
export function useSongDocument(initial?: SongDocument, sourceId?: string) {
  const storageKey = sourceId ? `${STORAGE}:${sourceId}` : STORAGE;
  const [state, dispatch] = useReducer(reducer, { past: [], song: initial ?? PRESETS[0].song, future: [] });
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
  const edit = useCallback((song: SongDocument) => dispatch({ type: 'edit', song }), []);
  const undo = useCallback(() => dispatch({ type: 'undo' }), []);
  const redo = useCallback(() => dispatch({ type: 'redo' }), []);
  return { ...state, edit, undo, redo, canUndo: !!state.past.length, canRedo: !!state.future.length, ready, recovered };
}
