import { endpointRows } from "@/lib/openapi";
import { STYLES } from "@/lib/catalog";

export default function DocsPage() {
  const endpoints = endpointRows();

  return (
    <div className="container" style={{ paddingTop: 32, paddingBottom: 64, maxWidth: 800 }}>
      <h1>Docs</h1>
      <p>
        A game sound-effects bank filed by event, with 1 to 8 variants each, loudness-matched, every sound CC0-1.0.
        Read-only, no authentication, open CORS.
      </p>

      <h2>CLI</h2>
      <p>In an empty directory, against this site:</p>
      <pre className="card" style={{ overflowX: "auto" }}>
        <code>npx gamesounds add jump coin hit/heavy ui/confirm --style 8bit</code>
      </pre>
      <p>
        Writes the audio files, a <code>sounds.json</code> manifest and a <code>SOUNDS-CREDITS.md</code>, and verifies every
        file&apos;s SHA-256 against the manifest before exiting.
      </p>

      <h2>Runtime</h2>
      <pre className="card" style={{ overflowX: "auto" }}>
        <code>{`import { loadSounds } from "gamesounds";
const sounds = await loadSounds("./sounds.json");
sounds.play("jump");`}</code>
      </pre>
      <p>Round-robin variants, pitch jitter, a per-event cooldown, a voice cap with priority stealing, and ducking.</p>

      <h2>Styles</h2>
      <p>{STYLES.join(", ")}</p>

      <h2>REST API v1</h2>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr>
            <th style={{ textAlign: "left", borderBottom: "1px solid var(--border)", padding: "4px 8px" }}>Method</th>
            <th style={{ textAlign: "left", borderBottom: "1px solid var(--border)", padding: "4px 8px" }}>Path</th>
            <th style={{ textAlign: "left", borderBottom: "1px solid var(--border)", padding: "4px 8px" }}>What it does</th>
          </tr>
        </thead>
        <tbody>
          {endpoints.map((row) => (
            <tr key={`${row.method} ${row.path}`}>
              <td style={{ padding: "4px 8px", fontFamily: "var(--font-mono)" }}>{row.method}</td>
              <td style={{ padding: "4px 8px", fontFamily: "var(--font-mono)" }}>{row.path}</td>
              <td style={{ padding: "4px 8px" }}>{row.summary}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2>For agents</h2>
      <ul>
        <li>
          <a href="/llms.txt">/llms.txt</a>
        </li>
        <li>
          <a href="/skill.md">/skill.md</a>
        </li>
        <li>
          <a href="/openapi.json">/openapi.json</a>
        </li>
        <li>
          <a href="/.well-known/mcp.json">/.well-known/mcp.json</a>
        </li>
        <li>
          <a href="/schema/manifest-1.json">/schema/manifest-1.json</a>
        </li>
      </ul>
    </div>
  );
}
