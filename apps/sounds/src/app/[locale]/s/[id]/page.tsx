import { notFound } from "next/navigation";
import Link from "@/i18n/react";
import { getSound, listSounds } from "@/lib/catalog";
import { PlayButton } from "@/components/PlayButton";
import { Waveform } from "@/components/Waveform";
import { CopyForAgent } from "@/components/CopyForAgent";

export default async function SoundPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const sound = getSound(id);
  if (!sound) notFound();

  const similar = listSounds()
    .filter((s) => s.category === sound.category && s.id !== sound.id)
    .sort((a, b) => b.rank.score - a.rank.score || a.id.localeCompare(b.id))
    .slice(0, 6);

  return (
    <div className="container" style={{ paddingTop: 32, paddingBottom: 64 }}>
      <p className="muted">
        <Link href={`/c/${sound.category}`}>{sound.category}</Link>
      </p>
      <h1>{sound.title}</h1>
      <p>{sound.description}</p>
      <div className="row" style={{ gap: 8 }}>
        <span className="badge">{sound.style}</span>
        <span className="badge">{sound.license}</span>
        <span className="badge">{sound.origin}</span>
      </div>

      <div className="card" style={{ marginTop: 24 }}>
        <div className="row">
          <PlayButton sound={sound} label="Play" />
          <div style={{ flex: 1 }}>
            <Waveform peaks={sound.variants[0]?.peaks ?? []} height={48} soundId={sound.id} variantN={sound.variants[0]?.n} />
          </div>
          <a className="button button-accent" href={`/api/v1/sounds/${sound.id}.zip`} data-testid="download-button">
            Download all ({sound.variants.length} variant{sound.variants.length === 1 ? "" : "s"})
          </a>
        </div>
      </div>

      <h2 style={{ marginTop: 32 }}>Variants</h2>
      <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
        {sound.variants.map((variant) => (
          <li key={variant.n} className="row">
            <PlayButton sound={sound} variantIndex={variant.n - 1} label={`Variant ${variant.n}`} />
            <div style={{ flex: "0 0 160px" }}>
              <Waveform peaks={variant.peaks} soundId={sound.id} variantN={variant.n} />
            </div>
            <span className="muted" style={{ fontSize: "0.85em" }}>
              {variant.duration.toFixed(2)}s
            </span>
            <a href={variant.files.ogg.url} className="muted" style={{ fontSize: "0.85em" }}>
              .ogg
            </a>
            <a href={variant.files.mp3.url} className="muted" style={{ fontSize: "0.85em" }}>
              .mp3
            </a>
            <a href={variant.files.wav.url} className="muted" style={{ fontSize: "0.85em" }}>
              .wav
            </a>
            <code className="muted" style={{ fontSize: "0.75em" }} data-testid="variant-sha256">
              {variant.sha256.slice(0, 12)}
            </code>
          </li>
        ))}
      </ul>

      <h2 style={{ marginTop: 32 }}>Licence and source</h2>
      <ul>
        <li>Licence: {sound.license}</li>
        <li>Source: {sound.source.url ? <a href={sound.source.url}>{sound.source.name}</a> : sound.source.name}</li>
        <li>Author: {sound.source.author}</li>
        {sound.source.pack && <li>Pack: {sound.source.pack}</li>}
        {sound.attribution && <li>Attribution: {sound.attribution}</li>}
      </ul>

      <h2 style={{ marginTop: 32 }}>Measurements</h2>
      <ul>
        <li>Loudness: {sound.measure.lufs.toFixed(1)} LUFS</li>
        <li>True peak: {sound.measure.peakDb.toFixed(1)} dBTP</li>
        <li>Duration: {sound.measure.duration.toFixed(2)}s</li>
      </ul>

      <h2 style={{ marginTop: 32 }}>Use it from an agent</h2>
      <pre className="card" style={{ overflowX: "auto" }}>
        <code>GET /api/v1/sounds/{sound.id}</code>
      </pre>
      <CopyForAgent command={`npx gamesounds add ${sound.category} --style ${sound.style}`} />

      {similar.length > 0 && (
        <>
          <h2 style={{ marginTop: 32 }}>Similar sounds</h2>
          <ul>
            {similar.map((s) => (
              <li key={s.id}>
                <Link href={`/s/${s.id}`}>{s.title}</Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
