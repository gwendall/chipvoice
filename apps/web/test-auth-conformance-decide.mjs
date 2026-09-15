import { chromium } from "playwright";
/**
 * The person's half of a conformance run: vendor/auth-conformance.mjs hands
 * the verification link over in the environment, and this opens it in the
 * owner's browser session and presses the button a reviewer would. Approval is
 * a browser session by design, so the script cannot do this part itself.
 */
const choice = process.argv[2];
const url = process.env.AUTH_CONFORMANCE_VERIFICATION_URI_COMPLETE;
const cookie = process.env.CHIPVOICE_OWNER_COOKIE;
if (!["approve", "deny"].includes(choice)) throw new Error("approve or deny");
if (!url) throw new Error("AUTH_CONFORMANCE_VERIFICATION_URI_COMPLETE unset");
if (!cookie) throw new Error("CHIPVOICE_OWNER_COOKIE unset");
setTimeout(() => {
  console.error("TIMEOUT test-auth-conformance-decide");
  process.exit(1);
}, 45000).unref();
const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext();
  const [name, value] = cookie.split("=");
  await context.addCookies([
    { name, value, url: new URL(url).origin, httpOnly: true, sameSite: "Lax" },
  ]);
  const page = await context.newPage();
  await page.goto(url, { waitUntil: "load" });
  await page.getByRole("button", { name: "Review access", exact: true }).click();
  await page.getByRole("heading", { name: "Conformance run" }).waitFor();
  // The first artist is preselected; a fresh owner has exactly one.
  await page
    .getByRole("button", {
      name: choice === "approve" ? "Authorize this agent" : "Decline",
      exact: true,
    })
    .click();
  await page
    .getByRole("status")
    .filter({
      hasText: choice === "approve" ? "Access authorized." : "Access declined.",
    })
    .waitFor({ timeout: 10000 });
} finally {
  await browser.close();
}
