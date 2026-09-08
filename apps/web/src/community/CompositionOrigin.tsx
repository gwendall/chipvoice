"use client";
import { useT } from "@/i18n/react";
import type { CompositionOrigin as Origin } from "@/lib/projects";
export function CompositionOrigin({ origin }: { origin: Origin }) {
  const t = useT();
  const label = origin.method === "prompt" ? "Prompt-generated" : origin.method === "prompt-derived" ? "Remixed from prompt music" : "Direct composition";
  return <span className="composition-origin" title={t("This label records the creation method on Chipvoice; external AI use cannot be verified.")}>{t(label)}{origin.model ? ` · ${origin.model}` : ""}</span>;
}
