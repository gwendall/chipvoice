import { notFound } from "next/navigation";
import Link from "@/i18n/react";
import { getSound, buildManifest } from "@/lib/catalog";
import { getPack } from "@/lib/packs";
import { PlayButton } from "@/components/PlayButton";
import { Waveform } from "@/components/Waveform";

export default async function PackPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const pack = getPack(id);
  if (!pack) notFound();

  const { resolved, unresolved } = buildManifest(pack.events, { style: pack.style });

  return (
    <div className="container" style={{ paddingTop: 32, paddingBottom: 64 }}>
      <h1>{pack.title}</h1>
      <p>{pack.description}</p>
      <div className="row" style={{ gap: 8 }}>
        <span className="badge">{pack.style}</span>
        <span className="badge">{resolved.length - unresolved.length}/{pack.events.length} resolved</span>
      </div>

      <div style={{ marginTop: 24 }}>
        <a className="button button-accent" href={`/api/v1/packs/${pack.id}.zip`} data-testid="download-button">
          Download pack (.zip)
        </a>
      </div>

      <h2 style={{ marginTop: 32 }}>Events</h2>
      <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
        {resolved.map((entry) => {
          const sound = entry.sound ? getSound(entry.sound) : null;
          return (
            <li key={entry.event} className="row">
              <span style={{ flex: "0 0 140px" }}>{entry.event}</span>
              {sound ? (
                <>
                  <PlayButton sound={sound} />
                  <div style={{ flex: "0 0 120px" }}>
                    <Waveform peaks={sound.variants[0]?.peaks ?? []} />
                  </div>
                  <Link href={`/s/${sound.id}`}>{sound.title}</Link>
                </>
              ) : (
                <span className="muted">No candidate resolved for this event.</span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
