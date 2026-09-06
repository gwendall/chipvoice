import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
import mido

class ImportTests(unittest.TestCase):
    def run_file(self, events, *options):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'score.mid'
            midi = mido.MidiFile(ticks_per_beat=480)
            midi.tracks.append(mido.MidiTrack(events))
            midi.save(path)
            return subprocess.run([sys.executable, str(Path(__file__).with_name('import-midi.py')), str(path), '--track', '0', '--bars', '1', *options], capture_output=True, text=True)

    def test_note_and_rest(self):
        result = self.run_file([mido.Message('note_on', note=60, velocity=90), mido.Message('note_off', note=60, time=480)])
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout)['bars'], [{'melody': 'C4:1 r:3'}])

    def test_explicit_snap(self):
        events = [mido.Message('note_on', note=60, velocity=90, time=4), mido.Message('note_off', note=60, time=476)]
        self.assertNotEqual(self.run_file(events).returncode, 0)
        result = self.run_file(events, '--snap')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertTrue(json.loads(result.stdout)['timingChanges'])

    def test_carried_controllers(self):
        for control in [mido.Message('pitchwheel', pitch=2048), mido.Message('control_change', control=64, value=127)]:
            events = [control, mido.Message('note_on', note=60, velocity=90, time=1920), mido.Message('note_off', note=60, time=480)]
            self.assertNotEqual(self.run_file(events, '--start-beat', '4').returncode, 0)
        events = [mido.Message('pitchwheel', pitch=2048), mido.Message('pitchwheel', pitch=0, time=960), mido.Message('note_on', note=60, velocity=90, time=960), mido.Message('note_off', note=60, time=480)]
        result = self.run_file(events, '--start-beat', '4')
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_rejects_ambiguous_inputs(self):
        on = mido.Message('note_on', note=60, velocity=90)
        off = mido.Message('note_off', note=60, time=480)
        cases = [
            [on],
            [on, mido.Message('note_on', note=64, velocity=90), off, mido.Message('note_off', note=64)],
            [mido.MetaMessage('time_signature', numerator=3, denominator=4), on, off],
            [on, mido.MetaMessage('set_tempo', tempo=600000, time=120), off],
            [mido.Message('control_change', control=64, value=127), on, off],
            [on, mido.Message('note_off', note=60, time=2400)],
        ]
        for events in cases:
            with self.subTest(events=events):
                self.assertNotEqual(self.run_file(events).returncode, 0)


class ReferenceTests(unittest.TestCase):
    def extract(self, events, **options):
        import importlib.util
        spec = importlib.util.spec_from_file_location('reference', Path(__file__).with_name('extract-reference.py'))
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'source.mid'
            midi = mido.MidiFile(ticks_per_beat=480)
            midi.tracks.append(mido.MidiTrack(events))
            midi.save(path)
            return module.extract(path, {'beats':4, 'selections':[{'track':0,'from':0,'to':4,'offset':0,'transpose':0,'voice':'monophonic'}], **options})

    def test_reference_preserves_source_timing(self):
        result = self.extract([mido.Message('note_on',note=60,velocity=90,time=5),mido.Message('note_off',note=60,time=155)])
        self.assertEqual(result['notes'], [[5/480,1/3,60]])
        self.assertEqual(len(result['sourceSha256']),64)

    def test_reference_rejects_ambiguous_voice(self):
        with self.assertRaisesRegex(ValueError,'polyphonic'):
            self.extract([mido.Message('note_on',note=60,velocity=90),mido.Message('note_on',note=64,velocity=90),mido.Message('note_off',note=60,time=480),mido.Message('note_off',note=64)])
        with self.assertRaisesRegex(ValueError,'cuts a held'):
            self.extract([mido.Message('note_on',note=60,velocity=90),mido.Message('note_off',note=60,time=2000)])

    def test_expression_is_reported(self):
        result = self.extract([mido.Message('pitchwheel',pitch=1024),mido.Message('note_on',note=60,velocity=90),mido.Message('note_off',note=60,time=480)])
        self.assertIn('pitchwheel',result['expressionEvents'][0]['event'])

if __name__ == '__main__':
    unittest.main()
