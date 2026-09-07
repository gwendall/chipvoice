import { alternates } from "@/i18n/metadata";
import Explore from "@/community/Explore";
import { profileByHandle } from "@/lib/projects";
import { hasDatabase } from "@/lib/db";
import { notFound } from "next/navigation";
export async function generateMetadata({
  params,
}: {
  params: Promise<{ handle: string; locale: string }>;
}) {
  const { handle, locale } = await params;
  return {
    title: `@${handle} · chipvoice`,
    description:
      locale === "ja"
        ? `chipvoiceで@${handle}の音楽を聴く。`
        : `Music by @${handle} on chipvoice.`,
    alternates: alternates(`/u/${handle}`, locale === "ja" ? "ja" : "en"),
  };
}
export default async function Page({
  params,
}: {
  params: Promise<{ handle: string; locale: string }>;
}) {
  const { handle } = await params;
  if (!hasDatabase()) return <Explore handle={handle} />;
  const profile = await profileByHandle(handle);
  if (!profile) notFound();
  return <Explore handle={handle} initialProfile={profile} />;
}
