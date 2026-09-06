#!/usr/bin/env python3
"""Freeze source MIDI note evidence, independently of the tracker compiler.

Selections are explicit in sources.json. This is a notation reference, not a
MIDI player: controller and tempo events are reported, never silently applied.
Review and commit the output separately; scores:build cannot rewrite evidence.
"""
import argparse
import hashlib
import json
from pathlib import Path
import mido


def extract(file, config):
    mid = mido.MidiFile(file)
    if mid.type == 2 or mid.ticks_per_beat <= 0:
        raise ValueError('Expected synchronous PPQ MIDI')
    tracks, expression, duplicate_onsets = [], [], 0
    for index, track in enumerate(mid.tracks):
        tick, active, notes = 0, {}, []
        for event in track:
            tick += event.time
            if event.type in ('set_tempo', 'pitchwheel', 'time_signature') or (event.type == 'control_change' and event.control == 64):
                expression.append({'track': index, 'tick': tick, 'event': str(event)})
            if index not in {part['track'] for part in config['selections']} or event.type not in ('note_on', 'note_off'):
                continue
            key = (event.channel, event.note)
            if event.type == 'note_on' and event.velocity:
                if key in active and active[key][0] != tick:
                    raise ValueError(f'Overlapping note-on in track {index}')
                if key in active:
                    duplicate_onsets += 1
                else:
                    active[key] = [tick]
            elif key in active:
                start = active[key].pop(0)
                if not active[key]:
                    del active[key]
                notes.append((start / mid.ticks_per_beat, tick / mid.ticks_per_beat, event.note))
        if active:
            raise ValueError(f'Unterminated notes in track {index}')
        tracks.append(sorted(notes))
    selected = []
    for part in config['selections']:
        notes = [n for n in tracks[part['track']] if n[1] > part['from'] and n[0] < part['to']]
        if any(n[0] < part['from'] or n[1] > part['to'] for n in notes):
            raise ValueError('Selection cuts a held source note')
        if part['voice'] != 'monophonic':
            raise ValueError('Select a monophonic source voice explicitly')
        for start, end, pitch in notes:
            selected.append([start - part['from'] + part['offset'], end - part['from'] + part['offset'], pitch + part['transpose']])
    selected.sort()
    for i, note in enumerate(selected):
        if not 12 <= note[2] <= 119 or note[0] >= note[1]:
            raise ValueError(f'Invalid source note {i}')
        if i and note[0] < selected[i - 1][1] - config.get('maxOverlapBeats', 0) - 1e-9:
            raise ValueError(f'Voice selection remains polyphonic at beat {note[0]}')
    return {'version': 1, 'sourceSha256': hashlib.sha256(Path(file).read_bytes()).hexdigest(),
            'sourcePPQ': mid.ticks_per_beat, 'selection': config,
            'duplicateNoteOns': duplicate_onsets, 'expressionEvents': expression,
            'timingToleranceBeats': 1 / 24 + 1e-8, 'beats': config['beats'],
            'notes': selected}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('id', choices=['mario', 'zelda', 'sonic'])
    parser.add_argument('file', type=Path)
    args = parser.parse_args()
    config = json.loads(Path(__file__).with_name('sources.json').read_text())[args.id]
    print(json.dumps(extract(args.file, config), indent=2))
