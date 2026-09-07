"use client";
import { useT } from "@/i18n/react";
import Link from "@/i18n/react";
import { SiteHeader, SiteFooter } from "@/ui/components";
import "./style.css";
export default function Docs() {
  const t = useT();
  return (
    <>
      <SiteHeader active="docs" />
      <main className="demo-main docs-page">
        <h1>{t("Small API. Real sound chips.")}</h1>
        <p>
          {t(
            "The SDK creates and plays music locally. The HTTP API publishes it. You do not need an account or a server to make sound.",
          )}
        </p>
        <code>npm i chipvoice</code>
        <section>
          <h2>{t("Play your project")}</h2>
          <pre>{`import { ProjectPlayer } from 'chipvoice';\n\nconst player = new ProjectPlayer();\nawait player.load(project);\nplayButton.onclick = () => player.play();\n\nplayer.pause();\nplayer.seek(12);          // Seconds, using the audible clock\nplayer.restart();\nawait player.update({ chip: 'snes', tempoScale: 1.1 });\nplayer.dispose();         // Closes only contexts it owns`}</pre>
          <p>
            {t(
              "Loading prepares audio in a cancellable worker. A failed or superseded update keeps the current music. Updates apply when ready and preserve the musical position.",
            )}
          </p>
        </section>
        <section>
          <h2>{t("Import, validate and render")}</h2>
          <pre>{`import { importMidi, projectFromPerformance, validateProject,\n  renderProject, toWav } from 'chipvoice';\n\nconst project = projectFromPerformance(importMidi(bytes), 'snes');\n// Explicitly permit reported hardware voice omissions:\nproject.settings.allowLoss = true;\nconsole.log(validateProject(project));\nconst { audio, plan } = renderProject(project); // Node or worker\nconsole.log(plan?.losses, plan?.mix);\nconst wav = toWav(audio);`}</pre>
          <p>
            {t(
              "Performance sources retain notes, timing, expression and instruments. Legacy scores retain their authored mix. Native captures keep their original commands until you adapt them.",
            )}
          </p>
        </section>
        <section>
          <h2>{t("Publish and remix")}</h2>
          <pre>{`POST /api/v1/projects\nAuthorization: Bearer YOUR_API_KEY\nIdempotency-Key: a-unique-request-id\nContent-Type: application/json\n\n{ "project": { ... }, "visibility": "public" }\n\nGET /api/v1/projects?q=orbit&chip=snes\nGET /api/v1/projects/PROJECT_ID\n\n// Publish a remix: add "parentId": "PROJECT_ID"\n// Immutable preview / complete render jobs:\nPOST /api/v1/projects/PROJECT_ID/render\n{ "kind": "preview" }\nGET /api/v1/jobs/JOB_ID`}</pre>
          <p>
            {t(
              "Publish with a browser session or API key. Use public, unlisted or private visibility. Reuse the same request key only to retry the same publication. New revisions get new IDs.",
            )}
          </p>
          <p>
            {t(
              "Previews contain up to 30 seconds. Complete server exports are bounded to 40 MB and 240 seconds of processing; longer jobs fail explicitly. Export locally when needed.",
            )}
          </p>
          <a href="/.well-known/openapi.json">{t("OpenAPI contract")} ↗</a>
        </section>
        <section>
          <h2>{t("Musical controls and limits")}</h2>
          <p>
            {t(
              "Choose a console, tempo, transposition and per-part instruments, trim and importance. Hardware limits remain real: omitted notes and approximate sounds are reported, not hidden.",
            )}
          </p>
          <p>
            {t(
              "The SDK accepts up to ten minutes per performance. Public projects support up to 4 MB of data. Published audio is pinned to its renderer; a new engine requires a new publication.",
            )}
          </p>
          <p>
            {t(
              "For game sound effects and custom sequencing, Chip, APU and the individual chip cores remain available.",
            )}
          </p>
          <a href="https://github.com/gwendall/chipvoice/tree/main/packages/chipvoice">
            {t("Full SDK reference")} ↗
          </a>
        </section>
        <Link href="/create">{t("Create a song")} →</Link>
      </main>
      <SiteFooter />
    </>
  );
}
