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
  const token = process.env.DOMANI_API_KEY;
  if (!token) return false;

  const text = [
    "Here is your chipvoice key.",
    "",
    key,
    "",
    "Use it on writes:",
    `  curl -H 'Authorization: Bearer ${key}' ...`,
    "",
    "Or open this link once to put it into your browser, and never see it again:",
    `  ${link}`,
    "",
    "It is the only copy - only its fingerprint is stored, so it cannot be looked",
    "up or resent. Ask for another if you lose it.",
    "",
    "chipvoice.dev",
  ].join("\n");

  try {
    const response = await fetch(sendUrl(FROM), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ to, subject: "Your chipvoice key", text }),
    });
    return response.ok;
  } catch {
    return false;
  }
}
