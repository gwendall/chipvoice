'use client';
import {useT} from '@/i18n/react';
import Link from '@/i18n/react';
import {SiteHeader, SiteFooter} from '@/ui/components';

export default function Terms() {
 const t = useT();
  return <><SiteHeader active="terms"/><main className="demo-main about-main">
    <span className="micro">{t("LEGAL")}</span>
    <h1>{t("Terms of use")}</h1>
    <p className="legal-updated">{t("Last updated 2026-09-29.")}</p>
    <p>{t("chipvoice.dev is currently a free, invitation-only closed beta. These terms are short on purpose; if anything here is unclear, write to us.")}</p>
    <section>
      <h2>{t("Your songs are yours")}</h2>
      <p>{t("If you write or generate a song with chipvoice, you own what chipvoice renders for you. chipvoice claims no ownership over your music.")}</p>
      <p>{t("When you publish a song, you grant chipvoice a non-exclusive licence to host, stream, render and display that publication for as long as it stays published.")}</p>
      <p>{t("This includes the site's existing remix feature: once a song is public, anyone may fork it and publish their own version, and the site shows where it came from, the way every song's page already shows its lineage. Unlisted and private songs are not shared this way.")}</p>
    </section>
    <section>
      <h2>{t("Original music, not known melodies")}</h2>
      <p>{t("Prompt-to-music generation is instructed to write an original piece and to decline reproducing a specific existing song's melody, riff or lyrics, even when a prompt names or closely describes one.")}</p>
      <p>{t("That is an instruction to the model, not a guarantee. chipvoice makes no warranty that generated output is free of third-party rights, and you are responsible for what you publish.")}</p>
    </section>
    <section>
      <h2>{t("A free, invitation-only beta")}</h2>
      <p>{t("Prompt-to-music generation is currently invitation-only and free, with a daily limit per account and a monthly budget for the whole site. If you are not yet invited, have reached today's limit, or the month's budget is spent, composing is unavailable; the app tells you which, without revealing the underlying numbers.")}</p>
    </section>
    <section>
      <h2>{t("Using chipvoice")}</h2>
      <p>{t("Use chipvoice to make, publish and share music. Do not use it to publish content you have no right to publish, to harass others, or to get around the invitation, daily or budget limits above.")}</p>
    </section>
    <section>
      <h2>{t("Changes")}</h2>
      <p>{t("chipvoice is an early, actively developed project. These terms may change as it does; we will update the date above when they do.")}</p>
    </section>
    <section>
      <h2>{t("Contact")}</h2>
      <p>{t("Questions about these terms: ")}<a href="mailto:hello@chipvoice.dev">{t("hello@chipvoice.dev")}</a>.</p>
    </section>
    <Link href="/privacy" className="small-button">{t("Read the privacy policy →")}</Link>
  </main><SiteFooter/></>;
}
