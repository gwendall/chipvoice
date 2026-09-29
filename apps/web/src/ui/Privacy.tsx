'use client';
import {useT} from '@/i18n/react';
import Link from '@/i18n/react';
import {SiteHeader, SiteFooter} from '@/ui/components';

export default function Privacy() {
 const t = useT();
  return <><SiteHeader active="privacy"/><main className="demo-main about-main">
    <span className="micro">{t("LEGAL")}</span>
    <h1>{t("Privacy policy")}</h1>
    <p className="legal-updated">{t("Last updated 2026-09-29.")}</p>
    <p>{t("This page describes exactly what chipvoice stores today, in plain language. If the product changes what it stores, this page changes with it.")}</p>
    <section>
      <h2>{t("Your account")}</h2>
      <p>{t("Signing in only needs an email address: chipvoice sends a one-time link, valid for 30 minutes, and no password is stored. Your email identifies your account and is never shown on a public page; only the display name or handle you choose for a profile is public.")}</p>
    </section>
    <section>
      <h2>{t("Your songs")}</h2>
      <p>{t("A saved or published song stores its score, title and console choice, and, once you publish it, a public profile and a visibility you choose: public, unlisted or private. The account that owns a song is never exposed in that song's public API response or page.")}</p>
    </section>
    <section>
      <h2>{t("Your prompts")}</h2>
      <p>{t("If you generate a song from a text prompt, chipvoice stores that prompt, tied to your account. It is private by default: chipvoice never returns or displays a prompt to anyone but the account that wrote it, whether or not the resulting song is published.")}</p>
      <p>{t("Your prompt is sent to chipvoice's model provider, OpenAI, to check it against OpenAI's moderation and to produce the song. chipvoice does not use prompts to train any model.")}</p>
      <p>{t("chipvoice may refuse to generate a song: OpenAI's moderation can reject the prompt itself, and a separate check can reject a result that too closely matches a well-known melody.")}</p>
      <p>{t("See ")}<a href="https://developers.openai.com/api/docs/guides/your-data">{t("OpenAI's own description of how it handles API data")}</a>{t(" for what that means on its side.")}</p>
      <p>{t("chipvoice keeps a generation's prompt for as long as its song exists. Withdrawing a generated song deletes its prompt too; the record that you generated a song (its model and token usage, which keep the beta's shared budget honest) stays, but the prompt text itself does not. A prompt whose song was never withdrawn is kept indefinitely.")}</p>
    </section>
    <section>
      <h2>{t("Who else handles it")}</h2>
      <p>{t("Running chipvoice depends on a few other services, each seeing only what its own job needs:")}</p>
      <ul>
        <li>{t("Vercel hosts chipvoice.dev and keeps its own standard web server logs, which include IP addresses, for every request.")}</li>
        <li>{t("Turso hosts the database that stores your account, songs, publications and prompts.")}</li>
        <li>{t("domani sends your sign-in email, so it receives the address to deliver it to.")}</li>
        <li>{t("OpenAI receives your prompt, as described above, to check it against OpenAI's moderation and to generate your song.")}</li>
      </ul>
    </section>
    <section>
      <h2>{t("Deleting your data")}</h2>
      <p>{t("There is currently no self-serve way to delete an entire account. Write to ")}<a href="mailto:hello@chipvoice.dev">{t("hello@chipvoice.dev")}</a>{t(" and we will delete your account, songs and prompts by hand.")}</p>
    </section>
    <section>
      <h2>{t("Who can see what")}</h2>
      <p>{t("A public song, its title, console, tags and audio, is visible to anyone with the link, and listed in Explore. An unlisted song is visible only to whoever has its link. A private song, and every prompt, is visible only to its owner.")}</p>
    </section>
    <section>
      <h2>{t("Cookies and browser storage")}</h2>
      <p>{t("Signing in sets one cookie that keeps you signed in for 30 days. Your browser also keeps a couple of things locally on your device: any song or prompt you are still drafting, so a reload does not lose it, and a short-lived cache of your own signed-in account details, so the app does not have to re-check on every page. chipvoice runs no analytics or advertising trackers.")}</p>
    </section>
    <section>
      <h2>{t("Changes and contact")}</h2>
      <p>{t("This policy may change as chipvoice does; we will update the date above when it does. Questions: ")}<a href="mailto:hello@chipvoice.dev">{t("hello@chipvoice.dev")}</a>.</p>
    </section>
    <Link href="/terms" className="small-button">{t("Read the terms of use →")}</Link>
  </main><SiteFooter/></>;
}
