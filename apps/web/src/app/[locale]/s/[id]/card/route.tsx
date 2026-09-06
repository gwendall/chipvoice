import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createTranslator,isLocale,localePath} from '@/i18n/core';
import {getMessages} from '@/i18n/server';
import {MACHINES,ROLE_NAMES} from '@/studio/document';
import { ImageResponse } from "next/og";
import { find } from "@/lib/songs";
import { hasDatabase } from "@/lib/db";

export const runtime = "nodejs";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/**
 * The card a shared link shows.
 *
 * It draws the song's own grid - four rows of blocks, one per sixteenth - so
 * the preview is a picture of the thing rather than a logo. Somebody scrolling
 * a chat sees the shape of the music before they press play.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; locale: string }> },
) {
  const {id,locale:value}=await params;
  const locale=isLocale(value)?value:'en',t=createTranslator(await getMessages(locale));
  if (!hasDatabase()) return new Response("no database", { status: 503 });
  const found = await find(id);
  if (!found) return new Response("not found", { status: 404 });

  const song = found.song;
  const pattern = song.patterns[song.order[0]] ?? song.patterns[0];
  const rows = (["lead", "chord", "bass", "perc"] as const).map((track) => ({
    track,
    cells: pattern[track].trim().split(/\s+/).slice(0, 32),
  }));

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          background: "#0d1016",
          color: "#e7eaf0",
          padding: 64,
          fontFamily: "Chipvoice Japanese",
        }}
      >
        <div style={{ display: "flex", fontSize: 26, color: "#7d8595", letterSpacing: 4 }}>
          CHIPVOICE · {MACHINES.find(machine=>machine.id===song.chip)?.chip}
        </div>
        <div style={{ display: "flex", fontSize: 64, marginTop: 8, color: "#e8973a" }}>
          {song.title ?? song.id}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 44 }}>
          {rows.map((row) => (
            <div key={row.track} style={{ display: "flex", alignItems: "center", gap: 14 }}>
              <div style={{ display: "flex", width: 150, fontSize: 22, color: "#7d8595" }}>
                {t(ROLE_NAMES[row.track])}
              </div>
              <div style={{ display: "flex", gap: 3 }}>
                {row.cells.map((token, i) => (
                  <div
                    key={i}
                    style={{
                      width: 25,
                      height: 40,
                      background:
                        token === "." ? "#171b24" : token === "=" ? "#242b38" : "#b96f14",
                    }}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>

        <div style={{ display: "flex", marginTop: "auto", fontSize: 26, color: "#7d8595", gap: 32 }}>
          <div style={{ display: "flex" }}>{song.bpm} BPM</div>
          <div style={{ display: "flex" }}>chipvoice.dev{localePath(`/s/${song.id}`,locale)}</div>
        </div>
      </div>
    ),
    {...size,fonts:[{name:'Chipvoice Japanese',data:await readFile(join(process.cwd(),'assets/fonts/chipvoice-japanese.woff')),weight:400,style:'normal'}]},
  );
}
