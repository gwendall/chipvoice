# Readable frontend type — 2026-09-06

<p align="center">
  <a href="READABLE-TYPE-2026-09-06.md">English</a> &bull;
  <a href="READABLE-TYPE-2026-09-06_ja.md">日本語</a>
</p>


The playground, listening lab, About and component catalogue now share four type
roles: labels (14px), body (16px), section headings (24px), and responsive page
headings (32–44px), expressed in rem. Mobile layouts no longer reduce labels to
6–10px. Inputs keep the body size. Navigation, effect pads, filters and footer
wrap to accommodate readable text.

The shared footer links “Made by gwendall” to https://gwendall.com, using the
spelling and URL confirmed by the author.

## Validation

- Production build and TypeScript check passed.
- Computed text sizes and horizontal overflow checked on all four routes at
  320, 390, 768, 820, 1024 and 1280px: no visible text below 14px and no page overflow.
- Expanded editor, code and sharing controls checked at 320 and 390px.
- Enlarging the browser root text size to 20px at a 390px viewport preserved
  layout and increased labels to 17.5px. Total: 27 visual audit states.
- Desktop and mobile screenshots inspected. Evidence is in
  `.artifacts/readable-type/`, including computed-size `result.json`.
- Existing demo and lab browser checks passed, covering measured audio, effects,
  keyboard/touch editing, recording, sharing, exports and continuous lab selection.

The general demo audibility/SFX test now selects the accompanied Overworld loop
after checking the fresh Mario arrival. Instantaneous measurements on a melody-only
score can coincide with a written rest. The dedicated arrival and composition
checks still cover Mario and the other familiar melodies. This changes only the
test fixture, not the scores or audio implementation.
