import { Domani, DomaniError } from "domani";
import { createTranslator, type Locale } from "@/i18n/core";
import { getMessages } from "@/i18n/server";
/**
 * Sending mail, through domani.
 *
 * chipvoice.dev is registered and DNS-managed there already, so its mail is
 * too: one account, one bill, one place where the domain lives. The alternative
 * was a second provider to verify a domain that is already verified somewhere
 * else.
 *
 * Failure is reported to the caller so the UI can offer another sign-in attempt.
 * Only temporary login links are sent; agent credentials never enter email.
 */
const FROM = process.env.CHIPVOICE_MAIL_FROM ?? "hello@chipvoice.dev";

export async function sendSignInEmail(
  to: string,
  link: string,
  locale: Locale = "en",
): Promise<boolean> {
  const t = createTranslator(await getMessages(locale));
  return send(
    to,
    t("Sign in to chipvoice"),
    [
      t("Open this link to sign in. It works once, for 30 minutes."),
      link,
      t("Your API keys remain unchanged."),
      "chipvoice.dev",
    ].join("\n\n"),
  );
}

async function send(
  to: string,
  subject: string,
  text: string,
): Promise<boolean> {
  const token = process.env.DOMANI_API_KEY;
  if (!token) return false;
  try {
    const client = new Domani({
      apiKey: token,
      baseUrl: process.env.DOMANI_BASE_URL,
      fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(10_000) }),
    });
    const result = await client.sendEmailByAddress(FROM, { to, subject, text });
    return !!result.id || !!result.message_id;
  } catch (error) {
    // Never log provider bodies, addresses, credentials or the sign-in URL.
    console.error("Sign-in mail failed", {
      provider: "domani",
      status: error instanceof DomaniError ? error.status : null,
      code: error instanceof DomaniError && /^[A-Z_]{1,64}$/.test(error.code) ? error.code : "MAIL_UNAVAILABLE",
    });
    return false;
  }
}
