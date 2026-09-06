#!/usr/bin/env python3
"""Extract a monophonic phrase from a score editor's MIDI export.

Requires mido (see requirements.txt). Outputs a review draft, never a published
cartridge. Explicitly reports onset/release snapping and rejects overlaps/ties
across bars instead of guessing which voice or articulation was intended.
"""
import argparse
import hashlib
import json
from pathlib import Path
import mido

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('file', type=Path)
parser.add_argument('--track', type=int, required=True)
parser.add_argument('--start-beat', type=float, default=0)
parser.add_argument('--bars', type=int, default=4)
parser.add_argument('--min-note', type=int, default=0)
parser.add_argument('--max-note', type=int, default=127)
parser.add_argument('--transpose', type=int, default=0)
parser.add_argument('--snap', action='store_true', help='Explicitly fit performed timing to a sixteenth grid')
args = parser.parse_args()
if not 1 <= args.bars <= 16 or args.start_beat < 0:
    parser.error('Choose 1–16 bars and a non-negative starting beat')
mid = mido.MidiFile(args.file)
if mid.type == 2 or mid.ticks_per_beat <= 0 or not 0 <= args.track < len(mid.tracks):
    parser.error('Expected a synchronous PPQ MIDI file and an existing track')
tempo, meter = 500000, (4, 4)
channels = {event.channel for event in mid.tracks[args.track]
            if event.type in ('note_on', 'note_off') and args.min_note <= event.note <= args.max_note}
controls, timeline = {}, []
for track in mid.tracks:
    tick = 0
    for event in track:
        tick += event.time
        timeline.append((tick, event))
for tick, event in sorted(timeline, key=lambda entry: entry[0]):
    beat = tick / mid.ticks_per_beat
    if beat >= args.start_beat + args.bars * 4:
        break
    if event.type == 'time_signature':
        value = (event.numerator, event.denominator)
        if beat <= args.start_beat:
            meter = value
        elif value != (4, 4):
            parser.error('This draft format supports 4/4 only')
    if event.type == 'set_tempo':
        if beat > args.start_beat:
            parser.error('Tempo changes in the phrase require manual review')
        tempo = event.tempo
    if event.type == 'pitchwheel' or (event.type == 'control_change' and event.control == 64):
        if event.channel not in channels:
            continue
        value = event.pitch != 0 if event.type == 'pitchwheel' else event.value >= 64
        if beat <= args.start_beat:
            controls[(event.channel, event.type)] = value
        elif value:
            parser.error('Sustain pedal or pitch bend needs a reviewed score reduction')
if meter != (4, 4):
    parser.error('This draft format supports 4/4 only')
if any(controls.values()):
    parser.error('Sustain pedal or pitch bend is already active at the excerpt start')
notes, active, changes = [], {}, []
time = 0
for event in mid.tracks[args.track]:
    time += event.time
    if event.type not in ('note_on', 'note_off') or not args.min_note <= event.note <= args.max_note:
        continue
    key = (event.channel, event.note)
    if event.type == 'note_on' and event.velocity:
        if key in active:
            parser.error('Overlapping note-on messages need review')
        active[key] = time
    elif key in active:
        start = active.pop(key) / mid.ticks_per_beat - args.start_beat
        end = time / mid.ticks_per_beat - args.start_beat
        if end <= 0 or start >= args.bars * 4:
            continue
        if start < 0 or end > args.bars * 4:
            parser.error('An excerpt edge cuts a held note; choose another boundary')
        points = [start, end]
        for point in points:
            if abs(point * 4 - round(point * 4)) > 1e-7:
                if not args.snap:
                    parser.error('Off-grid timing: inspect it or explicitly use --snap')
                changes.append({'beat': point, 'renderedBeat': round(point * 4) / 4})
        start, end = (round(point * 4) for point in points)
        pitch = event.note + args.transpose
        if not 12 <= pitch <= 119 or start >= end:
            parser.error('A note is outside the supported pitch/duration range')
        if start // 16 != (end - 1) // 16:
            parser.error('Cross-bar ties require a reviewed manual transcription')
        notes.append((start, end, pitch))
if any(t / mid.ticks_per_beat < args.start_beat + args.bars * 4 for t in active.values()):
    parser.error('Unterminated note in selected phrase')
if not notes:
    parser.error('No notes selected')
line = [None] * (args.bars * 16)
for start, end, pitch in sorted(notes):
    if any(line[step] is not None for step in range(start, end)):
        parser.error('Polyphonic phrase: choose the melody track or narrow the pitch range')
    for step in range(start, end):
        line[step] = (start, pitch)
names = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B']
bars = []
for bar in range(args.bars):
    cursor, stop, tokens = bar * 16, (bar + 1) * 16, []
    while cursor < stop:
        value = line[cursor]
        end = cursor + 1
        while end < stop and line[end] == value:
            end += 1
        note = 'r' if value is None else names[value[1] % 12] + str(value[1] // 12 - 1)
        tokens.append(f'{note}:{(end - cursor) / 4:g}')
        cursor = end
    bars.append({'melody': ' '.join(tokens)})
print(json.dumps({'status': 'review-required', 'sourceSha256': hashlib.sha256(args.file.read_bytes()).hexdigest(),
                  'bpm': mido.tempo2bpm(tempo), 'track': args.track, 'startBeat': args.start_beat, 'transpose': args.transpose,
                  'timingChanges': changes, 'bars': bars}, indent=2))
