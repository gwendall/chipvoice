# Automatic mixing foundations — 2026-09-07

<p align="center"><a href="AUTOMATIC-MIXING-FOUNDATIONS-2026-09-07.md">English</a> &bull; <a href="AUTOMATIC-MIXING-FOUNDATIONS-2026-09-07_ja.md">日本語</a></p>

## Reproduced failures

`scores/mixing/diagnose.mjs` captures the first 12 seconds of Zelda's native NES
and Mega Drive adaptation, both full mix and isolated parts, at the same gain.
The native bass is 5.50 dB below the melody; the adaptation bass is 6.42 dB above
it, a foreground reversal of 11.92 dB. `check-baseline.mjs` fails on these actual
recordings. Isolated percussion is quiet (-63.27 dBFS RMS on Mega Drive), so
this excerpt's dominant pulse is primarily the bass. Solos are diagnostic;
nonlinear mixing means they cannot reconstruct the native full mix by addition.

A separate regression shows that an explicit FM harmony patch is allocated to
PSG despite free FM channels. That voice cannot apply the chosen patch. The
allocation and calibration repairs follow the output correction.

## Output correction

The Mega Drive low-pass ran after sample-rate reduction. Ultrasonic multiplexed
pin activity had already aliased into audible frequencies. Move the low-pass
to the YM internal clock before averaging; retain its existing 2,840 Hz profile.
No native command, digital state machine, channel level or analog-profile
frequency is retuned. The coupling high-pass remains at the output sample rate.

`test/md-output.mjs` drives independent sinusoidal pin signals. At 44.1 kHz,
the folded component from a 53.1 kHz input drops from 0.05098 to 0.00847;
440 Hz gain remains about 0.988. The test uses analytical RC and box-window
bounds, also at 48 kHz, and failed before the correction.

For Sonic's first 12 seconds, 8–10 kHz spectral power as a fraction of total
power falls from 0.004038 to 0.000342. Independent GME is 0.000875. This removes
an identified alias mechanism; it does not prove identical PCM or physical sound.

Independent GME stems use its public mute interface (FM1–5, PCM, PSG), built
against the existing pinned oracle revision. The corrected PSG-to-FM RMS ratio
is -5.42 dB versus -5.33 dB in GME. That excerpt provides no reason to retune the
FM/PSG ratio to address Zelda's bass problem. DAC-to-FM differs by about 2.32 dB;
GME routes DAC through a separate synthesis path. Further physical capture is
needed before attributing this difference to a hardware-model error.

## Evidence and scope

Artifacts: `.artifacts/automatic-mixing/before/` and `sonic-output/` contain WAV,
reference PCM, JSON and inspected spectrograms. `gme-stems.cpp` uses the pinned
GME build; `compare-sonic.py` uses NumPy/SciPy/Matplotlib for descriptive plots.
Existing executable sources/oracle builds stay local. The generated corpus
split and policy limits are in `scores/mixing/contract.json`; held-out songs
have not been used to fit this correction.

The complete SDK unit suite passes. The intentional Mega Drive PCM change is
recorded in its golden; NES, Game Boy, SNES and C64 goldens remain unchanged.
Full publication and browser qualification remain pending until the general
adaptation policy is integrated. Device timing and human preference are not
certified by these local measurements.
