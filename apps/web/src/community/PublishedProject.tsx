"use client";
import {PublicationPlay} from "@/player/Player";
import { useEffect, useState } from "react";
import { useT } from "@/i18n/react";
import Link from "@/i18n/react";
import { SiteHeader, SiteFooter, Button } from "@/ui/components";
import type { Publication } from "@/lib/projects";
import { DEMO_MACHINES } from "@/studio/document";
import { PixelAvatar } from "./avatar";
import { CompositionOrigin } from "./CompositionOrigin";
import Creator from "@/create/Creator";
export default function PublishedProject({ id }: { id: string }) {
  const t = useT(),
    [publication, setPublication] = useState<Publication | null>(null),
    [message, setMessage] = useState("Opening this song…"),
    [editing, setEditing] = useState(false);
  useEffect(() => {
    const abort = new AbortController(), started = Date.now();
    let timer: ReturnType<typeof setTimeout>;
    async function refresh() {
      try {
        const response = await fetch(`/api/v1/projects/${id}`, { signal: abort.signal });
        const p = await response.json();
        if (!response.ok) throw Error(p.message ?? "Publication not found");
        if (abort.signal.aborted) return;
        setPublication(p); setMessage("");
        const pending = p.renditions?.filter((r: { status: string }) => ["queued", "rendering", "cancelling"].includes(r.status)) ?? [];
        if (Date.now() - started < 600000 && (pending.length || !p.renditions?.length && p.origin?.method === "prompt" && Date.now() - started < 15000)) {
          if (p.owned) for (const job of pending) await fetch(`/api/v1/jobs/${job.id}`, { signal: abort.signal });
          timer = setTimeout(refresh, 2000);
        }
      } catch (e) { if (!abort.signal.aborted) setMessage(e instanceof Error ? e.message : "Publication not found"); }
    }
    void refresh();
    return () => { abort.abort(); clearTimeout(timer); };
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
          {publication.generation && <details className="demo-main">
            <summary>{t("Composition prompt")}</summary>
            <p>{publication.generation.prompt}</p>
            <p>{t("Model")}: {publication.generation.model}</p>
          </details>}
          {publication.owned && <div className="demo-main project-actions publication-sharing">
            <label>{t("Song visibility")} <select aria-label={t("Song visibility")} value={publication.visibility} onChange={async e => {
              const visibility = e.target.value;
              try {
                const response = await fetch(`/api/v1/projects/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ visibility }) });
                if (!response.ok) throw Error("visibility");
                setPublication(await response.json()); setMessage(visibility === "public" ? "Your song is public and appears on your artist page." : "Song visibility updated.");
              } catch { setMessage("Could not update song visibility."); }
            }}><option value="private">{t("private")}</option><option value="unlisted">{t("unlisted")}</option><option value="public">{t("public")}</option></select></label>
            <Link href="/library">{t("Your library")} →</Link>
          </div>}
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
              <p><CompositionOrigin origin={publication.origin} /></p>
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
                  <PublicationPlay item={publication} full/>
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
                  {t(publication.renditions?.some(r => ["queued", "rendering"].includes(r.status)) ? "Rendering the complete audio…" : "Open the project to prepare and hear the complete song.")}
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
