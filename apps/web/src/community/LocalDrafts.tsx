"use client";
import { useEffect, useState } from "react";
import Link, { useT } from "@/i18n/react";
import { listDrafts, draftHref } from "@/create/drafts";
import { Button } from "@/ui/components";
export default function LocalDrafts() {
  const t = useT(),
    [items, setItems] = useState<ReturnType<typeof listDrafts>>([]),
    [page, setPage] = useState(0);
  useEffect(() => {
    try {
      setItems(listDrafts());
    } catch {}
  }, []);
  return (
    <section className="local-drafts">
      <h2>{t("Local drafts")}</h2>
      <p>
        {t(
          "Saved on this browser only. Download JSON for an independent backup.",
        )}
      </p>
      {items.length ? (
        <>
          <div className="draft-list">
            {items.slice(page * 12, page * 12 + 12).map((item) => (
              <Link
                key={item.key}
                className="small-button"
                href={draftHref(item.key)}
              >
                {item.title} →
              </Link>
            ))}
          </div>
          <div className="part-tools">
            <Button disabled={!page} onClick={() => setPage(page - 1)}>
              ←
            </Button>
            <span>
              {page + 1} / {Math.ceil(items.length / 12)}
            </span>
            <Button
              disabled={(page + 1) * 12 >= items.length}
              onClick={() => setPage(page + 1)}
            >
              →
            </Button>
          </div>
        </>
      ) : (
        <Link href="/create">{t("Create a song")} →</Link>
      )}
    </section>
  );
}
