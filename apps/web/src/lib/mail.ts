import {createTranslator,type Locale} from '@/i18n/core';
import {getMessages} from '@/i18n/server';
/**
 * Sending mail, through domani.
 *
 * chipvoice.dev is registered and DNS-managed there already, so its mail is
 * too: one account, one bill, one place where the domain lives. The alternative
 * was a second provider to verify a domain that is already verified somewhere
 * else.
 *
 * Failure is reported, never thrown. A key that was created but not delivered
 * is a recoverable annoyance - ask for another - while a 500 on the sign-up
 * route looks like the product is broken.
 */
const FROM = process.env.CHIPVOICE_MAIL_FROM ?? "hello@chipvoice.dev";

/** The sending endpoint is per mailbox, not global. */
const sendUrl = (from: string) =>
  `https://domani.run/api/emails/${encodeURIComponent(from)}/send`;

export async function sendKeyEmail(
  to: string,
  key: string,
  link: string,
): Promise<boolean> {
  const text = [
    "Here is your chipvoice key.",
    "",
    key,
    "",
    "Use it on writes:",
    `  curl -H 'Authorization: Bearer ${key}' ...`,
    "",
    "Or open this link once to sign into your browser (valid for 30 minutes):",
    `  ${link}`,
    "",
    "It is the only copy - only its fingerprint is stored, so it cannot be looked",
    "up or resent. Ask for another if you lose it.",
    "",
    "chipvoice.dev",
  ].join("\n");

  return send(to, "Your chipvoice key", text);
}

export async function sendSignInEmail(to: string, link: string, locale: Locale = 'en'): Promise<boolean> {
  const t=createTranslator(await getMessages(locale));
  return send(to,t('Sign in to chipvoice'),[t('Open this link to sign in. It works once, for 30 minutes.'),link,t('Your API keys remain unchanged.'),'chipvoice.dev'].join('\n\n'));
}

async function send(to: string, subject: string, text: string): Promise<boolean> {
  const token = process.env.DOMANI_API_KEY;
  if (!token) return false;
  try {
    const response = await fetch(sendUrl(FROM), {
      method: "POST",
      signal: AbortSignal.timeout(10_000),
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ to, subject, text }),
    });
    return response.ok;
  } catch {
    return false;
  }
}
