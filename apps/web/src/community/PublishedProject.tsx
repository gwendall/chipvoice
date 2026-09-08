"use client";
import { useEffect, useState } from "react";
import { useT } from "@/i18n/react";
import Link from "@/i18n/react";
import { SiteHeader, SiteFooter, Button } from "@/ui/components";
import type { Publication } from "@/lib/projects";
import { DEMO_MACHINES } from "@/studio/document";
import { PixelAvatar } from "./avatar";
import Creator from "@/create/Creator";
export default function PublishedProject({ id }: { id: string }) {
  const t = useT(),
    [publication, setPublication] = useState<Publication | null>(null),
    [message, setMessage] = useState("Opening this song…"),
    [editing, setEditing] = useState(false);
  useEffect(() => {
    const abort = new AbortController();
    void fetch(`/api/v1/projects/${id}`, { signal: abort.signal })
      .then(async (r) => {
        const p = await r.json();
        if (!r.ok) throw Error(p.message ?? "Publication not found");
        setPublication(p);
        setMessage("");
      })
      .catch((e) => {
        if (!abort.signal.aborted) setMessage(e.message);
      });
    return () => abort.abort();
  }, [id]);
  const rendition =
    publication?.renditions?.find(
      (r) => r.kind === "full" && r.status === "ready",
    ) ?? publication?.renditions?.find((r) => r.status === "ready");

  return (
    <>
      <SiteHeader />
      {publication ? (
        <>
          <div className="demo-main publication-bar">
            <span>
              {t("Published revision")} · {publication.id}
            </span>
            {publication.parentId && (
              <Link href={`/p/${publication.parentId}`}>
                {t("Remixed from")} ↗
              </Link>
            )}
            <Button
              aria-pressed={publication.favourited}
              disabled={
                publication.owned || publication.visibility !== "public"
              }
              onClick={() =>
                void fetch(`/api/v1/projects/${id}/favourite`, {
                  method: publication.favourited ? "DELETE" : "PUT",
                }).then(async (r) => {
                  const data = await r.json();
                  if (r.ok)
                    setPublication((previous) =>
                      previous
                        ? {
                            ...previous,
                            favourited: data.favourited,
                            favourites: data.favourites,
                          }
                        : data,
                    );
                  else setMessage(data.message ?? "Sign in to save favourites");
                })
              }
            >
              {publication.favourited ? "♥" : "♡"} {publication.favourites}
            </Button>
            <details>
              <summary>{t("Report a problem")}</summary>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const data = new FormData(e.currentTarget);
                  void fetch(`/api/v1/projects/${id}/report`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ reason: data.get("reason") }),
                  }).then(async (r) =>
                    setMessage(
                      r.ok
                        ? "Report saved."
                        : ((await r.json()).message ?? "Could not report"),
                    ),
                  );
                }}
              >
                <input
                  name="reason"
                  aria-label={t("Report reason")}
                  minLength={3}
                  maxLength={500}
                  required
                />
                <Button type="submit">{t("Send report")}</Button>
              </form>
            </details>
          </div>
          {!editing && (
            <section className="demo-main published-listen">
              <div className="song-author">
                <PixelAvatar
                  id={publication.profile.id}
                  avatar={publication.profile.avatar}
                />
                {publication.profile.handle && (
                  <Link href={`/u/${publication.profile.handle}`}>
                    {publication.profile.displayName ||
                      publication.profile.handle}
                  </Link>
                )}
              </div>
              <h1>{publication.title}</h1>
              {!!publication.variants?.length && (
                <nav
                  className="project-actions"
                  aria-label={t("Console versions")}
                >
                  {publication.variants.map((v) => (
                    <Link
                      key={v.id}
                      className="small-button"
                      aria-current={v.id === id ? "page" : undefined}
                      href={`/p/${v.id}`}
                    >
                      {DEMO_MACHINES.find((m) => m.id === v.chip)?.name ??
                        v.chip}
                    </Link>
                  ))}
                </nav>
              )}
              <p>{publication.project?.description}</p>
              <p>
                {publication.project?.author
                  ? `${publication.project.author} · `
                  : ""}
                {publication.project?.licence &&
                publication.project.licence !== "reserved"
                  ? publication.project.licence
                  : t("No reuse licence granted")}
              </p>
              {publication.renditions?.some((r) => r.status === "ready") ? (
                <>
                  <p>
                    {t(
                      rendition?.kind === "full"
                        ? "Full song · preserved with this revision"
                        : "Published audio · preserved with this revision",
                    )}
                  </p>
                  <audio
                    controls
                    preload="none"
                    src={`/api/v1/jobs/${(publication.renditions.find((r) => r.kind === "full" && r.status === "ready") ?? publication.renditions.find((r) => r.status === "ready"))!.id}/audio`}
                  />
                  {rendition && (
                    <div className="project-actions">
                      <a
                        className="small-button"
                        href={`/api/v1/jobs/${rendition.id}/audio`}
                      >
                        {t("Download WAV")}
                      </a>
                      {rendition.mp3Bytes > 0 && (
                        <a
                          className="small-button"
                          href={`/api/v1/jobs/${rendition.id}/audio?format=mp3`}
                        >
                          {t("Download MP3")}
                        </a>
                      )}
                      <a className="small-button" href={publication.coverUrl}>
                        {t("Cover image")}
                      </a>
                    </div>
                  )}
                  {rendition?.kind !== "full" && (
                    <p>
                      {t(
                        "Previews contain up to 30 seconds. Open the project to hear or edit the complete song.",
                      )}
                    </p>
                  )}
                </>
              ) : (
                <p>
                  {t("Open the project to prepare and hear the complete song.")}
                </p>
              )}
              <Button onClick={() => setEditing(true)}>
                {t("Open / remix this project")} →
              </Button>
            </section>
          )}
          {editing && (
            <Creator
              embedded
              initial={publication.project}
              publication={publication}
            />
          )}
        </>
      ) : null}
      <p className="demo-main" role="status">
        {t.source(message)}
      </p>
      <SiteFooter />
    </>
  );
}
