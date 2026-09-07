import { getProject } from "@/lib/projects";
import { hasDatabase } from "@/lib/db";
import { alternates } from "@/i18n/metadata";
import PublishedProject from "@/community/PublishedProject";
export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string; locale: string }>;
}) {
  const { id, locale } = await params;
  const p = hasDatabase() ? await getProject(id) : null;
  const publicSong = p?.visibility === "public" ? p : null;
  const title =
    publicSong?.title ??
    (locale === "ja" ? "小さな曲 · chipvoice" : "A little song · chipvoice");
  const description =
    publicSong?.project?.description ??
    (locale === "ja"
      ? "聴いて、コードを開いて、自分の音楽にリミックス。"
      : "Listen, open the code and remix this song.");
  return {
    title,
    description,
    alternates: alternates(`/p/${id}`, locale === "ja" ? "ja" : "en"),
    robots: { index: !!publicSong, follow: !!publicSong },
    openGraph: { title, description },
    twitter: { card: "summary" as const, title, description },
  };
}
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  return <PublishedProject id={(await params).id} />;
}
