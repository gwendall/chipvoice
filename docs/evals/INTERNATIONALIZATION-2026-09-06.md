# English / Japanese website — 2026-09-06

## Scope

English retains its existing URLs. Japanese lives at `/ja`, including the player, composer, listening lab, About, component catalogue, shared songs and error pages. The header changes language in place. All site-owned text and accessible labels are catalogued in two JSON files; page metadata, social cards, sitemap alternates and sign-in messages follow the selected language. See [architecture and contribution rules](../INTERNATIONALIZATION.md).

## Visual review

| Before | After | Why |
| --- | --- | --- |
| English-only pages and labels | Japanese UI with native `English` / `日本語` selector | Both languages are discoverable without recognizing a flag. |
| Adding a selector produced three header rows on small screens | Wordmark and selector share the first row; navigation uses the second | Preserve readable type and space for the instrument. |
| English line wrapping | Japanese line-breaking with the existing spacing and font-size roles | Long Japanese labels wrap without clipping or shrinking the type. |
| Locale navigation could reload the instrument | Dictionary and native history update in place | Audio, MIDI imports, unsaved edits, query and fragment survive language changes. |
| A failed locale download could discard the session | A localized retry message preserves the current locale and instrument | A transient network problem must not lose music. |

Inspected full-page captures of the player, About, lab, component gallery and composer. The browser matrix checks 320, 390, 768 and 1280px on all four principal Japanese routes, and all three familiar song selections on the player. No horizontal page overflow. Existing mobile score-label wrapping remains readable. The captures include a real preparation state: the loader remains visible while the local renderer works.

- [Mobile player](i18n-home-mobile.png) · [Desktop player](i18n-home-desktop.png)
- [Mobile listening lab](i18n-lab-mobile.png) · [Mobile About](i18n-about-mobile.png)
- [Japanese share card](i18n-share-card.png)

## Deterministic and browser checks

- Catalogue/source audit: **605 keys**, identical key and placeholder sets, literal JSX/accessibility coverage and published arrangement/lab evidence coverage.
- Production Next build and monorepo TypeScript checks passed.
- Existing English publication/API/auth, audible playback, recording, editing, export, transport, lab, arrangements, long-MIDI and composition checks passed across the initial suite and its bounded continuation. The first transport attempt exposed the test race described below; its continuation passed.
- English canonical URLs return 200; `/en/about` redirects to `/about`. Japanese raw server HTML supplies `lang`, localized titles/descriptions, canonical/hreflang and Open Graph locale before hydration.
- Real audio during English → Japanese → back → forward: the same two A/B buffer sources remain active. One qualification measured output RMS **0.04579 before** and **0.06719 after** the first switch; playback position was preserved. This demonstrates continuity, not audio fidelity.
- Imported MIDI named `Play.mid`, track `Bass`, remains user content and stays loaded across language changes. Invalid MIDI shows a Japanese error and recovery action.
- Composer title `自分の曲`, tempo 177, code sample, validation errors, query and fragment survive language changes.
- A locally published song named `Midnight` stays `Midnight` in Japanese. Loading the built-in preset displays `真夜中`; Undo restores the user's title and Redo restores the translated preset. All user publications remain unchanged in storage.
- A real share card renders Japanese glyphs with the correct DMG chip label. The bundled Japanese font is traced into the server function and is not downloaded by site visitors.
- Invalid sign-in redemption preserves Japanese routing. Email delivery is not exercised; the disposable test environment disables the mail provider.
- Blocking the alternate dictionary download displays an error while preserving the imported MIDI, audio-source count and original URL.
- No uncaught browser exceptions in the Japanese E2E. Playwright videos, complete screenshots and JSON evidence are produced under `.artifacts/i18n/` and uploaded by CI.

## Review findings resolved

**Standards:** the independent review found title provenance outside document history. It now travels with undo/redo snapshots without changing the music schema. Follow-up: no remaining substantive findings.

**Spec:** the independent review found the same user-title collision through Undo. The browser regression covers it. Follow-up: no remaining substantive findings.

E2E also exposed a loopback-origin rewrite loop and an overly broad translated UI template matching a technical error. Locale rewrites now preserve the actual origin; only explicitly enumerated SDK/worker messages use source matching. UI interpolation uses exact catalogue keys. The existing transport E2E also sampled an old source when its generic ready check won a React commit race. It now waits for the actual replacement source before asserting console/tempo phase continuity; timing thresholds remain unchanged.

## Content boundary

User titles, MIDI track names, notes, technical identifiers, source hashes and machine-readable JSON/API resources retain their original meaning. They are not untranslated site copy. Unknown browser/network exceptions receive a localized fallback. Repository documentation is maintained in English. The Japanese translation has been inspected in context; this evaluation is not an independent native-speaker language review.
