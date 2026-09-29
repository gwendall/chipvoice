// Pure judging functions for scripts/check-browser-decode.mjs, split out into
// their own module so `node --test` can exercise the actual comparison logic
// directly, without launching a browser (GS-07 v2.1).
//
// GS-07 v2.1: the ogg content-loss oracle used to compare a browser's decode
// against the SOURCE WAV at an instantaneous 1e-3 crossing. That conflated
// two different things: the codec's own lossy quantization of an
// already-quiet decaying tail (which checkFormatEnergies already gates, on
// total energy, at the encoder level) with an actual DECODER cut (a browser
// returning less than what the file itself contains). Evidence this was the
// wrong oracle: on the rebuilt catalogue, the same 96 of 1080 oggs showed a
// gap past the old margin in BOTH Chromium and Firefox alike (96 and 96, 0
// flagged by only one engine) - and Firefox is independently proven to
// decode every one of those 1080 files whole. A real decoder cut shows up as
// a DISAGREEMENT between decoders, not as the same two independent decoders
// agreeing with each other and disagreeing with the wav; agreement between
// Chromium and Firefox, against a source the lossy codec is known to have
// requantized, is not evidence of anything wrong.
//
// The question this gate actually needs to answer is narrower and does not
// need the wav at all: "did the browser's own decoder return what is
// actually IN the file". The oracle for that is the codec's own REFERENCE
// decoder (sox/libvorbisfile) decoding those exact same bytes - not the wav,
// which the encoder has already legitimately lossily transformed. Comparing
// a browser's decode against a reference decode of the SAME file isolates
// browser-specific decoding quirks (for example Chromium's own internal
// end-of-buffer handling) from the codec's own, already-gated lossy
// transform.
export const DECODER_AGREEMENT_TOLERANCE = 1e-3; // -60 dBFS, the same audibility floor the old (wrong) wav-based rule used. Derived and stated BEFORE measuring the real catalogue - see check-browser-decode.mjs's own header for the measured max |browser - reference| this tolerance was checked against, which must land at least 10x below it in both engines or the gate refuses to ship.

/**
 * Compares a browser's decoded channel data against a reference decoder's
 * own decode of the same bytes, sample by sample, over `[0, sourceFrames)`.
 * Never searches for or corrects a lag - offset 0 is what a correct decode
 * at a matching sample rate (44.1kHz, no resampling) is expected to produce;
 * a systematic offset is a bug to report, not something to paper over here.
 *
 * Returns `{agrees: true}` if every sample agrees within `tolerance`,
 * otherwise `{agrees: false, firstIndex, lastIndex, maxDiff}` describing the
 * full extent of the disagreement.
 */
export function compareToReference(browser, reference, sourceFrames, tolerance = DECODER_AGREEMENT_TOLERANCE) {
  let maxDiff = 0;
  let firstIndex = -1;
  let lastIndex = -1;
  const n = Math.min(sourceFrames, browser.length, reference.length);
  for (let i = 0; i < n; i++) {
    const diff = Math.abs(browser[i] - reference[i]);
    if (diff > maxDiff) maxDiff = diff;
    if (diff > tolerance) {
      if (firstIndex === -1) firstIndex = i;
      lastIndex = i;
    }
  }
  return firstIndex === -1 ? { agrees: true, maxDiff } : { agrees: false, firstIndex, lastIndex, maxDiff };
}

/**
 * Judges one decoded result: decode errors and length are always checked;
 * sample-wise agreement with a reference decode is checked only when both
 * `referenceChannel` and `browserChannel` are given (mp3 never gets a
 * reference channel - GS-08's leading-delay defect is reported separately,
 * never gated here). `decoded` is `{length, error}` - the browser's actual
 * channel data is passed separately since it is only needed for the content
 * check, not the length/error checks.
 */
export function judge(format, sourceFrames, decoded, { referenceChannel, browserChannel, tolerance = DECODER_AGREEMENT_TOLERANCE } = {}) {
  const failures = [];
  if (decoded.error) {
    failures.push(`${format} failed to decode: ${decoded.error}`);
    return failures;
  }
  if (decoded.length < sourceFrames) {
    failures.push(`${format} decoded ${decoded.length} frame(s), ${sourceFrames - decoded.length} short of the source's own ${sourceFrames} frame(s)`);
  }
  if (referenceChannel && browserChannel) {
    const cmp = compareToReference(browserChannel, referenceChannel, sourceFrames, tolerance);
    if (!cmp.agrees) {
      failures.push(
        `${format}'s browser decode disagrees with the reference decoder from index ${cmp.firstIndex} to ${cmp.lastIndex} ` +
          `(inclusive), max |diff| ${cmp.maxDiff.toFixed(6)} (tolerance ${tolerance}) - the browser returned something ` +
          `other than what is actually in the file`,
      );
    }
  }
  return failures;
}
