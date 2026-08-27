/**
 * What a title may contain.
 *
 * This matters more than its size suggests: the title is composed onto a card
 * in the site's own colours, and that card is what Telegram, X and Discord
 * show. An unfiltered title is a way to make an official-looking image say
 * anything - which is the first abuse of every service that renders user text
 * into a picture.
 *
 * The rule is deliberately narrow rather than a blocklist. Blocklists are
 * bypassed the day after they ship; an allowlist of what a song title actually
 * needs is not.
 */
const ALLOWED = /^[\p{L}\p{N} .,'!?&()\-+:/]*$/u;
const MAX = 60;

export interface TitleCheck {
  ok: boolean;
  value: string;
  message?: string;
}

export function cleanTitle(input: string | undefined): TitleCheck {
  if (input === undefined) return { ok: true, value: "" };

  // Strip the invisible ones first: zero-width joiners and direction marks are
  // how a filtered string smuggles something past a reader's eye.
  const stripped = input
    .replace(/[​-‏‪-‮⁦-⁩﻿]/g, "")
    .replace(/\s+/g, " ")
    .trim();

  if (stripped.length === 0) return { ok: true, value: "" };
  if (stripped.length > MAX) {
    return {
      ok: false,
      value: "",
      message: `a title is at most ${MAX} characters; that one is ${stripped.length}`,
    };
  }
  if (!ALLOWED.test(stripped)) {
    return {
      ok: false,
      value: "",
      message:
        "a title can hold letters, numbers, spaces and . , ' ! ? & ( ) - + : / and nothing else",
    };
  }
  return { ok: true, value: stripped };
}

/** The same rule for the author line, which is displayed the same way. */
export function cleanAuthor(input: string | undefined): TitleCheck {
  return cleanTitle(input);
}
