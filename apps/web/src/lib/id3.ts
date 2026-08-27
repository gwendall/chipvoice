/**
 * An ID3v2.3 tag, written by hand.
 *
 * LAME produces frames and nothing else, so a file straight out of the encoder
 * has no title, no artist and no year. That matters more than the filename
 * does: Telegram, iTunes and every car stereo show the tag, not the name of the
 * file - so an untagged song arrives as "unknown", however carefully it was
 * named on the way out.
 *
 * Written here rather than pulled in: the format is a ten-byte header and a
 * list of frames, and a dependency for eighty lines is a dependency to keep
 * up to date for as long as the project lives.
 */

export interface Tags {
  title: string;
  artist: string;
  album?: string;
  year?: string;
  /** Shown as a comment, and the one place the link survives a re-share. */
  comment?: string;
  url?: string;
}

const utf16 = (text: string): Uint8Array => {
  // Encoding byte 1 is UTF-16 with a BOM, which is the only unicode encoding
  // v2.3 defines. Latin-1 would drop every accent our titles allow.
  const bytes = [0x01, 0xff, 0xfe];
  for (const unit of text) {
    const code = unit.codePointAt(0)!;
    if (code > 0xffff) {
      // Surrogate pair, little-endian.
      const adjusted = code - 0x10000;
      const high = 0xd800 + (adjusted >> 10);
      const low = 0xdc00 + (adjusted & 0x3ff);
      bytes.push(high & 0xff, high >> 8, low & 0xff, low >> 8);
    } else {
      bytes.push(code & 0xff, code >> 8);
    }
  }
  bytes.push(0, 0);
  return new Uint8Array(bytes);
};

/** A text frame: four-character id, size, two flag bytes, then the payload. */
function frame(id: string, payload: Uint8Array): Uint8Array {
  const out = new Uint8Array(10 + payload.length);
  for (let i = 0; i < 4; i++) out[i] = id.charCodeAt(i);
  const size = payload.length;
  // v2.3 sizes are plain 32-bit big-endian; only the tag header is synchsafe.
  out[4] = (size >>> 24) & 0xff;
  out[5] = (size >>> 16) & 0xff;
  out[6] = (size >>> 8) & 0xff;
  out[7] = size & 0xff;
  out.set(payload, 10);
  return out;
}

/**
 * COMM, which is the one frame with a shape of its own.
 *
 * Encoding byte, three language bytes, a description terminated by a null, then
 * the text. In UTF-16 both strings carry their own BOM and the terminator is
 * two bytes, not one - getting that length wrong produces a frame players
 * report as unreadable while everything around it loads fine, which is exactly
 * how this failed the first time.
 */
function comment(text: string): Uint8Array {
  const encoder = (value: string): number[] => {
    const out = [0xff, 0xfe];
    for (const unit of value) {
      const code = unit.codePointAt(0)!;
      if (code > 0xffff) {
        const adjusted = code - 0x10000;
        const high = 0xd800 + (adjusted >> 10);
        const low = 0xdc00 + (adjusted & 0x3ff);
        out.push(high & 0xff, high >> 8, low & 0xff, low >> 8);
      } else {
        out.push(code & 0xff, code >> 8);
      }
    }
    return out;
  };

  const payload = [
    0x01,             // UTF-16 with BOM
    0x65, 0x6e, 0x67, // eng
    ...encoder(""),   // empty description
    0x00, 0x00,       // its terminator, two bytes in UTF-16
    ...encoder(text),
  ];
  return frame("COMM", new Uint8Array(payload));
}

export function id3(tags: Tags): Uint8Array {
  const frames: Uint8Array[] = [
    frame("TIT2", utf16(tags.title)),
    frame("TPE1", utf16(tags.artist)),
  ];
  if (tags.album) frames.push(frame("TALB", utf16(tags.album)));
  if (tags.year) frames.push(frame("TYER", utf16(tags.year)));
  // The genre every player already knows how to show for this.
  frames.push(frame("TCON", utf16("Chiptune")));
  if (tags.comment) frames.push(comment(tags.comment));
  if (tags.url) {
    // WOAS is a URL frame: no encoding byte, plain ISO-8859-1, no terminator.
    const bytes = new TextEncoder().encode(tags.url);
    frames.push(frame("WOAS", bytes));
  }

  const body = frames.reduce((sum, f) => sum + f.length, 0);
  const out = new Uint8Array(10 + body);
  out[0] = 0x49; // I
  out[1] = 0x44; // D
  out[2] = 0x33; // 3
  out[3] = 3; // v2.3
  out[4] = 0;
  out[5] = 0; // no flags

  /*
   * The header size is synchsafe: seven bits per byte, so no byte of it can
   * look like the start of an audio frame. Getting this wrong is the classic
   * way to produce a tag that some players read and others treat as noise.
   */
  out[6] = (body >>> 21) & 0x7f;
  out[7] = (body >>> 14) & 0x7f;
  out[8] = (body >>> 7) & 0x7f;
  out[9] = body & 0x7f;

  let at = 10;
  for (const f of frames) {
    out.set(f, at);
    at += f.length;
  }
  return out;
}

/**
 * A filename a person can read, and one every filesystem accepts.
 *
 * Two forms, because `filename=` must be ASCII and our titles may hold accents.
 * A browser that understands `filename*` uses the readable one; anything older
 * falls back rather than saving something mangled.
 */
export function contentDisposition(title: string | null, id: string, ext: string) {
  const readable = (title ?? "").trim() || `chipvoice ${id}`;
  const safe = readable
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9 .\-_]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60);
  const ascii = (safe || `chipvoice ${id}`) + `.${ext}`;
  const unicode = encodeURIComponent(`${readable}.${ext}`);
  return `inline; filename="${ascii}"; filename*=UTF-8''${unicode}`;
}
