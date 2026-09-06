# English and Japanese website

<p align="center">
  <a href="INTERNATIONALIZATION.md">English</a> &bull;
  <a href="INTERNATIONALIZATION_ja.md">日本語</a>
</p>


## Specification

The public website is available in English and Japanese. English keeps the existing URLs; Japanese uses `/ja`. Cover all site-owned UI text, accessible labels, loading/error states, built-in music descriptions and evidence, page and share metadata. Language changes preserve the current page, query, hash, imported MIDI, composer draft and active audio. Keep the existing visual identity and readable mobile type. Use simple JSON catalogues, following the approach used by Domani.

## Architecture

- `apps/web/src/i18n/messages/en.json` and `ja.json` are the catalogues. Keys are English source copy, so contributors can search for the words visible on screen. Use complete sentences with named `{placeholders}` for new copy.
- `core.ts` handles locale paths and translation. UI interpolation is explicit. Only the canonical messages listed in `source-templates.json` use source matching through `t.source()`. This prevents a generic UI phrase such as “{elapsed} of {duration}” from accidentally matching an unrelated error. This keeps locale out of performance documents, render caches and audio-effect dependencies. The bounded translation cache is unrelated to the audio loop.
- `[locale]` is the single Next.js route tree. Both locales are pre-rendered. `proxy.ts` rewrites English URLs internally to `/en`; `/en` itself redirects to the original canonical address. APIs, audio, downloads and machine-readable resources retain their stable URLs. `skipProxyUrlNormalize` preserves the request origin, including loopback addresses, so a local rewrite cannot become an external request/redirect loop.
- `I18nProvider` supplies the selected dictionary. The selector loads the other dictionary on demand and updates native history so the instrument is not unmounted. Back/forward restores language. A failed dictionary download keeps the current instrument and displays a retry message; it never reloads the page. Internal page links use the locale-aware `Link`.
- Server metadata and in-place head updates share the page catalogue. Canonicals, `hreflang`, Open Graph locale/title/description, Twitter metadata, sitemap entries and share-card images reflect the language.
- Sign-in requests carry the locale through the email and redemption redirect. Authentication semantics and API error identifiers remain unchanged.

## Content boundary

Translate site-owned prose and display labels, including evidence paragraphs from the published audio reports. Keep user-written song titles, MIDI filenames, track names, notes and recordings as content. Music tokens, instrument/program IDs, source hashes, URLs, API/JSON property names and runnable JavaScript identifiers remain canonical: translating these would change the music or break consumers. English/native language names, product/library names and units such as MIDI, BPM and LUFS remain recognizable. Repository documentation and `/skill.md` / `/llms.txt` are developer resources, not alternate human-language website pages.

Built-in composer titles carry display provenance in undo/redo snapshots. Editing a title clears that provenance; imported, restored and shared titles are user content even when they happen to match a catalogue key. The flag is not part of the serialized music document.

The Japanese share-card font is bundled server-side under `apps/web/assets/fonts`; no font provider is contacted at runtime and the website does not download it. See that directory for source, license and reproduction instructions.

## Validation

Run `pnpm --filter chipvoice-web build`, then `pnpm --filter chipvoice-web test`. `test-i18n.mjs` verifies catalogue parity, placeholder parity, literal UI/accessibility coverage, published source/evidence coverage and route/template behavior. Browser qualification checks the real rendered website, audio continuity, import, composer state, metadata, Japanese sharing and mobile layouts. See the dated evaluation report for results and screenshots.
