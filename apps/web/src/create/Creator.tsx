"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ProjectPlayer,
  prepareProject,
  parseProject,
  repeatPerformanceSection,
  projectFromPerformance,
  importProjectMidi,
  performanceClock,
  type MusicProject,
  type PerformancePart,
} from "chipvoice";
import { useT, useErrorText } from "@/i18n/react";
import Link from "@/i18n/react";
import {
  SiteHeader,
  SiteFooter,
  MachinePicker,
  PlayButton,
  Button,
} from "@/ui/components";
import { RangeControl } from "@/ui/RangeControl";
import type { Profile } from "@/lib/projects";
import { Account } from "@/studio/Account";
import type { Publication } from "@/lib/projects";
import { PixelAvatar } from "@/community/avatar";
import { starterProject, GENERATOR_EXAMPLE } from "./starter";
import { runGenerator } from "./generator";
import PianoRoll from "./PianoRoll";
import "./style.css";
import {
  DRAFT_ROOT as DRAFT,
  newDraftKey,
  readDraft,
  isDraftKey,
} from "./drafts";
const TIMBRE_PRESETS = [
  [80, "Pulse"],
  [81, "Saw"],
  [0, "Piano"],
  [24, "Pluck"],
  [38, "Synth bass"],
  [48, "Strings"],
  [89, "Warm pad"],
] as const;
const stamp = (seconds: number) =>
  `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
export default function Creator({
  initial,
  publication,
  embedded = false,
  active = true,
}: {
  initial?: MusicProject;
  publication?: Publication;
  embedded?: boolean;
  active?: boolean;
}) {
  const errorText = useErrorText();
  const t = useT(),
    [project, setProject] = useState<MusicProject>(initial ?? starterProject),
    [ready, setReady] = useState(false),
    [view, setView] = useState<"notes" | "code">("notes"),
    [partId, setPartId] = useState("lead"),
    [bar, setBar] = useState(0);
  const [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [audio, setAudio] = useState({
      playing: false,
      preparing: false,
      progress: 0,
      error: "",
      seconds: 0,
      position: 0,
      losses: 0,
      project: null as MusicProject | null,
    }),
    [loop, setLoop] = useState(true),
    [solo, setSolo] = useState<string | null>(null);
  const [code, setCode] = useState(""),
    [codeMode, setCodeMode] = useState<"json" | "javascript">("json"),
    [generatorCode, setGeneratorCode] = useState(GENERATOR_EXAMPLE),
    [seed, setSeed] = useState(42);
  const [artists, setArtists] = useState<Profile[]>([]),
    [artistId, setArtistId] = useState(
      publication?.owned ? publication.profile.id : "",
    );
  const [sharing, setSharing] = useState(false),
    [visibility, setVisibility] = useState("public"),
    [published, setPublished] = useState<Publication | null>(
      publication ?? null,
    ),
    [job, setJob] = useState<{
      id: string;
      status: string;
      progress: number;
      audio: string | null;
      mp3Url: string | null;
      mp3Status: string;
      mp3Error: string | null;
      error: string | null;
    } | null>(null);
  useEffect(() => {
    if (!sharing) return;
    const controller = new AbortController();
    void fetch("/api/v1/profiles", { signal: controller.signal })
      .then(async (r) => {
        if (r.ok) {
          const p = await r.json();
          setArtists(p.items);
          setArtistId((current) => current || p.items[0]?.id || "");
        }
      })
      .catch(() => {});
    return () => controller.abort();
  }, [sharing]);
  const player = useRef<ProjectPlayer | null>(null),
    alive = useRef(true),
    projectRef = useRef(project),
    loaded = useRef<MusicProject | null>(null),
    history = useRef<MusicProject[]>([]),
    future = useRef<MusicProject[]>([]),
    [historyVersion, setHistoryVersion] = useState(0),
    requestKey = useRef(crypto.randomUUID()),
    importGeneration = useRef(0),
    importJob = useRef<AbortController | null>(null);
  const [barsPerPage, setBarsPerPage] = useState(2);
  useEffect(() => {
    const media = matchMedia("(max-width: 600px)");
    const update = () => setBarsPerPage(media.matches ? 1 : 2);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  const draftKey = useRef<string | null>(null);
  projectRef.current = project;
  const performance =
      project.source.kind === "score" ? null : project.source.performance,
    parts = performance?.parts ?? [],
    part = parts.find((p) => p.id === partId) ?? parts[0],
    bpm = performance
      ? 60000000 / performance.tempos[0].microsecondsPerBeat
      : project.source.kind === "score"
        ? project.source.score.bpm
        : 120;
  const clock = useMemo(
    () =>
      performance
        ? performanceClock(performance, project.settings.tempoScale)
        : null,
    [performance, project.settings.tempoScale],
  );
  const sourceSeconds = clock && performance ? clock(performance.endTick) : 0;
  const sync = () => {
    if (!alive.current || !player.current) return;
    const p = player.current;
    setAudio({
      playing: p.playing,
      project: p.audibleProject,
      preparing: p.preparing,
      progress: p.progress,
      error: p.error,
      seconds: p.duration,
      position: p.position,
      losses:
        p.prepared?.losses.filter((l) => l.kind === "voice-omitted").length ??
        0,
    });
  };
  const ensurePlayer = () => {
    if (!player.current) {
      player.current = new ProjectPlayer({ onChange: sync });
      player.current.loop = loop;
    }
    return player.current;
  };
  const edit = (next: MusicProject, remember = true) => {
    if (remember) {
      history.current = [...history.current.slice(-39), projectRef.current];
      future.current = [];
    }
    setHistoryVersion((v) => v + 1);
    setProject(next);
    projectRef.current = next;
    requestKey.current = crypto.randomUUID();
    setJob(null);
  };
  const undo = () => {
    const previous = history.current.pop();
    if (previous) {
      future.current.push(projectRef.current);
      edit(previous, false);
    }
  };
  const redo = () => {
    const next = future.current.pop();
    if (next) {
      history.current.push(projectRef.current);
      edit(next, false);
    }
  };
  const editPart = (next: PerformancePart) => {
    if (!performance) return;
    edit({
      ...project,
      generator: undefined,
      source: {
        kind: "performance",
        performance: {
          ...performance,
          parts: parts.map((p) => (p.id === next.id ? next : p)),
        },
      },
    });
  };
  const setting = (settings: Partial<MusicProject["settings"]>) =>
    edit({
      ...project,
      settings: {
        ...project.settings,
        ...settings,
        ...(settings.tempoScale !== undefined
          ? { tempoScale: Math.max(0.1, Math.min(10, settings.tempoScale)) }
          : {}),
      },
    });
  useEffect(() => {
    alive.current = true;
    let cancelled = false;
    void (async () => {
      try {
        const requestedKey = new URLSearchParams(location.search).get("draft");
        const requestedDraft =
          requestedKey && isDraftKey(requestedKey) ? requestedKey : null;
        draftKey.current = publication
          ? `${DRAFT}:${publication.id}`
          : (requestedDraft ??
            localStorage.getItem(`${DRAFT}:active`) ??
            newDraftKey());
        if (requestedDraft && !initial) {
          const saved = readDraft(requestedDraft);
          if (saved) setProject(saved);
          return;
        }
        if (initial && publication) {
          const saved = localStorage.getItem(`${DRAFT}:${publication.id}`);
          if (saved) setProject(parseProject(saved));
        }
        const piece = new URLSearchParams(location.search).get("piece");
        if (!initial && piece && ["mario", "zelda", "sonic"].includes(piece)) {
          draftKey.current = newDraftKey();
          setBusy(true);
          const r = await fetch(`/arrangement-data/${piece}.json`);
          if (!r.ok) throw Error("Source arrangement unavailable");
          const score = await r.json();
          if (!cancelled) {
            setProject({
              ...projectFromPerformance(
                score,
                piece === "sonic" ? "md" : "2a03",
              ),
              settings: {
                chip: piece === "sonic" ? "md" : "2a03",
                allowLoss: true,
              },
            });
            setNotice("Editing the source parts creates an adaptation.");
          }
        } else if (
          !initial &&
          new URLSearchParams(location.search).get("starter") === "orbit"
        ) {
          draftKey.current = newDraftKey();
          setProject(starterProject());
        } else if (!initial) {
          const saved = readDraft(draftKey.current!) ?? readDraft(DRAFT);
          if (saved) setProject(saved);
        }
      } catch {
        try {
          const raw =
            localStorage.getItem(draftKey.current ?? DRAFT) ??
            localStorage.getItem(DRAFT);
          if (raw)
            localStorage.setItem(
              `${DRAFT}:recovery:${crypto.randomUUID()}`,
              raw,
            );
        } catch {}
        draftKey.current = newDraftKey();
        if (!cancelled)
          setNotice("Could not restore this project. Your starter is ready.");
      } finally {
        if (!cancelled) {
          setReady(true);
          setBusy(false);
        }
      }
    })();
    return () => {
      cancelled = true;
      alive.current = false;
      importGeneration.current++;
      importJob.current?.abort();
      player.current?.dispose();
      player.current = null;
    };
  }, [initial]);
  useEffect(() => {
    if (!ready) return;
    try {
      const { generator, ...base } = project;
      const clean = generator ? project : base;
      const key = draftKey.current ?? DRAFT;
      localStorage.setItem(key, JSON.stringify(clean));
      if (key === DRAFT || key.startsWith(`${DRAFT}:draft:`)) {
        localStorage.setItem(DRAFT, JSON.stringify(clean));
        localStorage.setItem(`${DRAFT}:active`, key);
      }
      setCode(JSON.stringify(clean, null, 2));
    } catch {
      setNotice(
        "Could not save the local draft. Download the project to keep it.",
      );
    }
  }, [project, ready]);
  useEffect(() => {
    if (!ready || !player.current) return;
    const timer = setTimeout(() => {
      const p = player.current;
      if (p) {
        loaded.current = project;
        void p.load(project, { parts: solo ? [solo] : undefined });
      }
    }, 180);
    return () => clearTimeout(timer);
  }, [project.source, project.settings, solo, ready]);
  useEffect(() => {
    if (!active) player.current?.pause();
  }, [active]);
  useEffect(() => {
    if (!audio.playing) return;
    let frame = 0,
      last = 0;
    const tick = (now: number) => {
      if (now - last > 50) {
        last = now;
        sync();
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [audio.playing]);
  useEffect(() => {
    if (
      !job ||
      (!["queued", "rendering", "cancelling"].includes(job.status) &&
        job.mp3Status !== "queued")
    )
      return;
    const abort = new AbortController();
    const timer = setTimeout(() => {
      void fetch(`/api/v1/jobs/${job.id}`, { signal: abort.signal })
        .then((r) => r.json())
        .then((data) => {
          if (!abort.signal.aborted) {
            if (data.error && !data.id)
              setNotice(
                data.message ?? "Could not prepare the published audio.",
              );
            else setJob(data);
          }
        })
        .catch(() => {});
    }, 1500);
    return () => {
      clearTimeout(timer);
      abort.abort();
    };
  }, [job]);
  useEffect(() => {
    if (project.generator) {
      setGeneratorCode(project.generator.code);
      setSeed(project.generator.seed);
    }
  }, [project.generator]);
  const toggle = async () => {
    try {
      const p = ensurePlayer();
      if (p.playing) {
        p.pause();
        return;
      }
      await p.play();
      if (
        !loaded.current ||
        loaded.current.source !== project.source ||
        loaded.current.settings !== project.settings
      ) {
        loaded.current = project;
        await p.load(project, { parts: solo ? [solo] : undefined });
      }
    } catch {
      setNotice("Audio could not start. Try Play again.");
    }
  };
  const download = (bytes: BlobPart, name: string, type: string) => {
    const url = URL.createObjectURL(new Blob([bytes], { type }));
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const exportAudio = async () => {
    try {
      setBusy(true);
      const snapshot = parseProject(projectRef.current);
      const result = await prepareProject(snapshot);
      if (alive.current)
        download(result.wav, `${snapshot.title}.wav`, "audio/wav");
    } catch {
      setNotice("Could not export this song.");
    } finally {
      setBusy(false);
    }
  };
  const importFile = async (file: File) => {
    const ticket = ++importGeneration.current;
    importJob.current?.abort();
    const abort = new AbortController();
    importJob.current = abort;
    if (file.size > 4 * 1024 * 1024) {
      setNotice("Imports support files up to 4 MB.");
      return;
    }
    setBusy(true);
    setNotice("Importing your music…");
    try {
      const bytes = await file.arrayBuffer();
      let next: MusicProject;
      if (/\.midi?$/i.test(file.name)) {
        // Yield for the loading state before the bounded parser runs.
        await new Promise((resolve) => setTimeout(resolve, 0));
        next = await importProjectMidi(new Uint8Array(bytes), {
          signal: abort.signal,
          title: file.name.replace(/\.midi?$/i, ""),
          chip: project.settings.chip,
        });
        next.settings.allowLoss = true;
      } else next = parseProject(new TextDecoder().decode(bytes));
      if (ticket === importGeneration.current && alive.current) {
        draftKey.current = newDraftKey();
        setPublished(null);
        edit(next);
        setBar(0);
        setSolo(null);
        setNotice("Imported locally. Nothing has been uploaded.");
      }
    } catch (error) {
      if (ticket === importGeneration.current)
        setNotice(error instanceof Error ? error.message : "Import failed");
    } finally {
      if (ticket === importGeneration.current) setBusy(false);
    }
  };
  const applyCode = async () => {
    setBusy(true);
    try {
      const next =
        codeMode === "json"
          ? parseProject(code)
          : await runGenerator(generatorCode, seed, starterProject());
      edit(next);
      setNotice("Applied. Your previous version is available with Undo.");
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : "Could not apply this code",
      );
    } finally {
      setBusy(false);
    }
  };
  const publish = async () => {
    setBusy(true);
    try {
      const clean = JSON.parse(JSON.stringify(project));
      const r = await fetch("/api/v1/projects", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": requestKey.current,
        },
        body: JSON.stringify({
          project: clean,
          ...(artistId ? { profileId: artistId } : {}),
          visibility,
          ...(published ? { parentId: published.id } : {}),
        }),
      });
      const data = await r.json();
      if (!r.ok)
        throw Error(
          data.message ?? data.issues?.[0]?.message ?? "Could not publish",
        );
      setPublished(data);
      requestKey.current = crypto.randomUUID();
      setNotice("Published. This revision preserves your source and settings.");
      if (visibility !== "private") await startRender(data.id, "preview");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not publish");
    } finally {
      setBusy(false);
    }
  };
  const startRender = async (id: string, kind: "preview" | "full") => {
    const r = await fetch(`/api/v1/projects/${id}/render`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind }),
    });
    const data = await r.json();
    if (!r.ok) throw Error(data.message ?? "Render unavailable");
    setJob(data);
  };
  const addPart = () => {
    if (!performance || parts.length >= 256) return;
    const id = crypto.randomUUID();
    edit({
      ...project,
      source: {
        kind: "performance",
        performance: {
          ...performance,
          parts: [
            ...parts,
            { id, name: "New part", role: "lead", priority: 2, notes: [] },
          ],
        },
      },
    });
    setPartId(id);
  };
  const audibleClock = useMemo(() => {
    const current = audio.project;
    return current && current.source.kind !== "score"
      ? performanceClock(
          current.source.performance,
          current.settings.tempoScale,
        )
      : clock;
  }, [audio.project, clock]);
  let positionTick = 0;
  if (performance && audibleClock && audio.seconds) {
    let lo = 0,
      hi = performance.endTick;
    for (let i = 0; i < 40 && hi - lo > 1; i++) {
      const mid = Math.floor((lo + hi) / 2);
      if (audibleClock(mid) <= audio.position) lo = mid;
      else hi = mid;
    }
    positionTick = lo;
  }
  if (!ready)
    return (
      <>
        {!embedded && <SiteHeader active="create" />}
        <main className="demo-main creation">
          <p role="status">{t("Opening this song…")}</p>
        </main>
        {!embedded && <SiteFooter />}
      </>
    );
  return (
    <>
      {!embedded && <SiteHeader active="create" />}
      <main className="demo-main creation" aria-label={t("Music workspace")}>
        <div className="creation-heading">
          <div>
            <span className="micro">{t("MAKE SOME NOISE")}</span>
            <h1>{t("Your little music machine.")}</h1>
            <p>
              {t(
                "Write notes or code. Hear every console. Share something that sounds like you.",
              )}
            </p>
          </div>
          <Link href="/docs">{t("Use the API")} ↗</Link>
        </div>
        <div className="project-actions">
          <Button
            disabled={busy}
            onClick={() => {
              draftKey.current = newDraftKey();
              edit(starterProject());
              setPublished(null);
              setBar(0);
              setSolo(null);
            }}
          >
            {t("New song")}
          </Button>
          <label className="small-button file-button">
            {t("Import MIDI / JSON")}
            <input
              type="file"
              accept=".mid,.midi,.json"
              disabled={busy}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void importFile(file);
                e.target.value = "";
              }}
            />
          </label>
          <Button disabled={!history.current.length} onClick={undo}>
            {t("Undo")}
          </Button>
          <Button disabled={!future.current.length} onClick={redo}>
            {t("Redo")}
          </Button>
          <Button onClick={() => setSharing(!sharing)}>{t("Share")}</Button>
          <Link href="/explore">{t("Explore songs")} ↗</Link>
        </div>
        <section className="creation-instrument">
          <div className="project-title">
            <input
              aria-label={t("Song title")}
              maxLength={80}
              value={project.title}
              onChange={(e) => edit({ ...project, title: e.target.value })}
            />
            {published && (
              <Link
                href={
                  published.profile.handle
                    ? `/u/${published.profile.handle}`
                    : "/library"
                }
              >
                <PixelAvatar
                  id={published.profile.id}
                  avatar={published.profile.avatar}
                />
                {published.profile.displayName ||
                  published.profile.handle ||
                  t("Creator")}
              </Link>
            )}
          </div>
          <MachinePicker
            value={project.settings.chip}
            onChange={(chip) => setting({ chip })}
          />
          <div className="create-parameters">
            <RangeControl
              id="create-tempo"
              label={t("Tempo")}
              unit={t("BPM")}
              min={Math.max(
                1,
                Math.min(40, Math.ceil(bpm)),
                Math.ceil(bpm * 0.1),
              )}
              max={Math.max(
                Math.ceil(bpm),
                Math.min(300, Math.floor(bpm * 10)),
              )}
              value={Math.round(bpm * (project.settings.tempoScale ?? 1))}
              onChange={(value) => setting({ tempoScale: value / bpm })}
            />
            <RangeControl
              id="create-transpose"
              label={t("Transpose")}
              unit={t("semitones")}
              min={-12}
              max={12}
              value={project.settings.transpose ?? 0}
              onChange={(transpose) => setting({ transpose })}
            />
          </div>
          <div className="create-transport">
            <div className="progress-row">
              <input
                aria-label={t("Song position")}
                type="range"
                min={0}
                max={audio.seconds || 1}
                step={0.05}
                value={Math.min(audio.position, audio.seconds || 1)}
                onChange={(e) => {
                  player.current?.seek(Number(e.target.value));
                  sync();
                }}
              />
              <span>
                {stamp(audio.position)} /{" "}
                {stamp(audio.seconds || sourceSeconds)}
              </span>
            </div>
            <div className="transport-controls">
              <PlayButton
                playing={audio.playing}
                loading={audio.preparing}
                pause
                disabled={!ready || busy}
                onClick={() => void toggle()}
              />
              <Button onClick={() => player.current?.restart()}>
                {t("Restart")}
              </Button>
              <Button
                aria-pressed={loop}
                onClick={() => {
                  setLoop(!loop);
                  if (player.current) player.current.loop = !loop;
                }}
              >
                {t("Loop")}
              </Button>
              <Button onClick={() => void exportAudio()}>
                {t("Download WAV")}
              </Button>
              <Button
                onClick={() =>
                  download(
                    JSON.stringify(project, null, 2),
                    `${project.title}.json`,
                    "application/json",
                  )
                }
              >
                {t("Download project")}
              </Button>
            </div>
          </div>
          <nav className="create-tabs" aria-label={t("Editor view")}>
            <Button
              aria-pressed={view === "notes"}
              onClick={() => setView("notes")}
            >
              {t("Notes")}
            </Button>
            <Button
              aria-pressed={view === "code"}
              onClick={() => setView("code")}
            >
              {t("Code")}
            </Button>
            <span>
              {parts.length} {t("parts")}
            </span>
          </nav>
          {view === "notes" && (
            <>
              {performance && part ? (
                <>
                  <div className="part-layout">
                    <aside className="part-list">
                      {parts.map((p) => (
                        <button
                          key={p.id}
                          aria-pressed={p.id === part.id}
                          onClick={() => setPartId(p.id)}
                        >
                          <span
                            className={`part-symbol ${p.role}`}
                            aria-hidden="true"
                          >
                            {p.role === "perc"
                              ? "▥"
                              : p.role === "bass"
                                ? "▁"
                                : p.role === "chord"
                                  ? "≋"
                                  : "♪"}
                          </span>
                          <span>{t(p.name)}</span>
                          <small>{p.notes.length}</small>
                        </button>
                      ))}
                      <Button onClick={addPart}>{t("Add part")} ＋</Button>
                    </aside>
                    <div className="note-editor">
                      <div className="part-tools">
                        <input
                          aria-label={t("Part name")}
                          value={part.name}
                          maxLength={80}
                          onChange={(e) =>
                            editPart({ ...part, name: e.target.value })
                          }
                        />
                        <select
                          aria-label={t("Part role")}
                          value={part.role}
                          onChange={(e) =>
                            editPart({
                              ...part,
                              role: e.target.value as PerformancePart["role"],
                              roleInference: {
                                confidence: "high",
                                reason: "override",
                              },
                            })
                          }
                        >
                          {(["lead", "chord", "bass", "perc"] as const).map(
                            (r, i) => (
                              <option key={r} value={r}>
                                {t(["Melody", "Harmony", "Bass", "Drums"][i])}
                              </option>
                            ),
                          )}
                        </select>
                        <Button
                          aria-pressed={solo === part.id}
                          onClick={() =>
                            setSolo(solo === part.id ? null : part.id)
                          }
                        >
                          {t("Solo")}
                        </Button>
                        <Button
                          onClick={() =>
                            editPart({
                              ...part,
                              muted: !part.muted,
                            })
                          }
                        >
                          {t(part.muted ? "Unmute" : "Mute")}
                        </Button>
                      </div>
                      <div className="part-tools">
                        <label className="timbre-control">
                          {t("Timbre")}
                          <select
                            aria-label={t("Timbre")}
                            value={part.program ?? part.notes[0]?.program ?? 80}
                            onChange={(e) => {
                              const program = Number(e.target.value);
                              editPart({
                                ...part,
                                program,
                                origin: undefined,
                                instruments: undefined,
                                portableTimbres: undefined,
                                notes: part.notes.map((n) => ({
                                  ...n,
                                  program,
                                })),
                              });
                            }}
                          >
                            {!TIMBRE_PRESETS.some(
                              ([program]) =>
                                program ===
                                (part.program ?? part.notes[0]?.program ?? 80),
                            ) && (
                              <option
                                value={
                                  part.program ?? part.notes[0]?.program ?? 80
                                }
                              >
                                {t(
                                  part.origin
                                    ? "Source instrument {program}"
                                    : "GM program {program}",
                                  {
                                    program:
                                      part.program ??
                                      part.notes[0]?.program ??
                                      80,
                                  },
                                )}
                              </option>
                            )}
                            {TIMBRE_PRESETS.map(([v, label]) => (
                              <option key={v} value={v}>
                                {t(String(label))}
                              </option>
                            ))}
                          </select>
                        </label>
                        <RangeControl
                          id="part-trim"
                          label={t("Part level")}
                          unit="dB"
                          min={-24}
                          max={6}
                          value={part.mix?.gainDb ?? 0}
                          onChange={(gainDb) =>
                            editPart({ ...part, mix: { ...part.mix, gainDb } })
                          }
                        />
                        <Button
                          onClick={() => {
                            const id = crypto.randomUUID();
                            edit({
                              ...project,
                              source: {
                                kind: "performance",
                                performance: {
                                  ...performance,
                                  parts: [
                                    ...parts,
                                    {
                                      ...structuredClone(part),
                                      id,
                                      name: part.name + " copy",
                                    },
                                  ],
                                },
                              },
                            });
                            setPartId(id);
                          }}
                        >
                          {t("Duplicate")}
                        </Button>
                        <Button
                          disabled={parts.length <= 1}
                          onClick={() =>
                            edit({
                              ...project,
                              source: {
                                kind: "performance",
                                performance: {
                                  ...performance,
                                  parts: parts.filter((p) => p.id !== part.id),
                                },
                              },
                            })
                          }
                        >
                          {t("Remove")}
                        </Button>
                      </div>
                      <details className="advanced-part">
                        <summary>{t("Advanced part controls")}</summary>
                        <RangeControl
                          id="part-importance"
                          disabled={project.settings.mix === "authored"}
                          label={t("Mix importance")}
                          unit="%"
                          min={0}
                          max={100}
                          value={Math.round((part.mix?.importance ?? 1) * 100)}
                          onChange={(value) =>
                            editPart({
                              ...part,
                              mix: { ...part.mix, importance: value / 100 },
                            })
                          }
                        />
                        <label>
                          {t("Voice priority")}
                          <input
                            type="number"
                            min={-100000}
                            max={100000}
                            value={part.priority}
                            onChange={(e) =>
                              editPart({
                                ...part,
                                priority: Number(e.target.value),
                              })
                            }
                          />
                        </label>
                      </details>
                      <div className="bar-navigation">
                        <Button
                          disabled={bar === 0}
                          onClick={() =>
                            setBar((v) => Math.max(0, v - barsPerPage))
                          }
                        >
                          ←
                        </Button>
                        <span>
                          {t("Bars")} {bar + 1}
                          {barsPerPage > 1 ? `–${bar + barsPerPage}` : ""}
                        </span>
                        <Button
                          disabled={
                            (bar + barsPerPage) *
                              performance.ticksPerBeat *
                              4 >=
                            performance.endTick
                          }
                          onClick={() => setBar((v) => v + barsPerPage)}
                        >
                          →
                        </Button>
                        <Button
                          onClick={() =>
                            setBar(
                              Math.floor(
                                positionTick /
                                  (performance.ticksPerBeat * 4 * barsPerPage),
                              ) * barsPerPage,
                            )
                          }
                        >
                          {t("Follow playhead")}
                        </Button>
                        <Button
                          onClick={() => {
                            try {
                              const start = bar * 4 * performance.ticksPerBeat;
                              edit({
                                ...project,
                                generator: undefined,
                                source: {
                                  kind: "performance",
                                  performance: repeatPerformanceSection(
                                    performance,
                                    start,
                                    Math.min(
                                      start +
                                        4 *
                                          barsPerPage *
                                          performance.ticksPerBeat,
                                      performance.endTick,
                                    ),
                                  ),
                                },
                              });
                            } catch (error) {
                              setNotice(
                                error instanceof Error
                                  ? error.message
                                  : "Invalid section range",
                              );
                            }
                          }}
                        >
                          {t("Repeat section")}
                        </Button>
                        <Button
                          onClick={() =>
                            edit({
                              ...project,
                              source: {
                                kind: "performance",
                                performance: {
                                  ...performance,
                                  loopStartTick:
                                    bar * 4 * performance.ticksPerBeat,
                                },
                              },
                            })
                          }
                        >
                          {t("Loop from here")}
                        </Button>
                      </div>
                      <PianoRoll
                        key={part.id}
                        part={part}
                        columns={barsPerPage * 16}
                        ticksPerBeat={performance.ticksPerBeat}
                        startTick={bar * 4 * performance.ticksPerBeat}
                        positionTick={positionTick}
                        onEdit={(next) => {
                          const max = next.notes.reduce(
                            (end, n) => Math.max(end, n.endTick),
                            performance.endTick,
                          );
                          edit({
                            ...project,
                            generator: undefined,
                            source: {
                              kind: "performance",
                              performance: {
                                ...performance,
                                endTick: max,
                                parts: parts.map((p) =>
                                  p.id === next.id ? next : p,
                                ),
                              },
                            },
                          });
                        }}
                      />
                    </div>
                  </div>
                </>
              ) : (
                <p>
                  {t(
                    "This legacy score keeps its original sound. Edit its JSON in Code.",
                  )}
                </p>
              )}
            </>
          )}
          {view === "code" && (
            <div className="code-workspace">
              <div className="part-tools">
                <Button
                  aria-pressed={codeMode === "json"}
                  onClick={() => setCodeMode("json")}
                >
                  {t("Project JSON")}
                </Button>
                <Button
                  aria-pressed={codeMode === "javascript"}
                  onClick={() => setCodeMode("javascript")}
                >
                  {t("JavaScript")}
                </Button>
                {codeMode === "javascript" && (
                  <label>
                    {t("Seed")}
                    <input
                      type="number"
                      min={0}
                      max={4294967295}
                      value={seed}
                      onChange={(e) => setSeed(Number(e.target.value))}
                    />
                  </label>
                )}
                <Button disabled={busy} onClick={() => void applyCode()}>
                  {t(busy ? "Preparing…" : "Apply changes")}
                </Button>
              </div>
              <textarea
                aria-label={t(
                  codeMode === "json" ? "Project JSON" : "JavaScript generator",
                )}
                spellCheck={false}
                value={codeMode === "json" ? code : generatorCode}
                onChange={(e) =>
                  codeMode === "json"
                    ? setCode(e.target.value)
                    : setGeneratorCode(e.target.value)
                }
              />
              <p>
                {t(
                  "Invalid code keeps the last playable version. Visual edits detach notes from the generator.",
                )}
              </p>
            </div>
          )}
          <p className="create-status" role="status">
            {busy
              ? t("Preparing…")
              : audio.preparing
                ? `${t("Preparing audio…")} ${Math.round(audio.progress * 100)}%`
                : audio.error
                  ? t.source(audio.error)
                  : t("Your music stays local until you publish.")}
          </p>
          {audio.losses > 0 && (
            <details>
              <summary>
                {audio.losses} {t("notes omitted by this console")}
              </summary>
              <p>
                {t(
                  "The source is intact. Hardware voices are limited; higher-priority parts take precedence.",
                )}
              </p>
            </details>
          )}
        </section>
        {sharing && (
          <section className="creation-share">
            <h2>{t("Give your song a home.")}</h2>
            <label>
              {t("Description")}
              <textarea
                maxLength={2000}
                value={project.description ?? ""}
                onChange={(e) =>
                  edit({ ...project, description: e.target.value })
                }
              />
            </label>
            <label>
              {t("Tags")}
              <input
                placeholder={t("original, ambient, game")}
                key={JSON.stringify(project.tags ?? [])}
                defaultValue={(project.tags ?? []).join(", ")}
                onBlur={(e) =>
                  edit({
                    ...project,
                    tags: e.target.value
                      .split(",")
                      .map((s) => s.trim())
                      .filter(Boolean)
                      .slice(0, 8),
                  })
                }
              />
            </label>
            <label>
              {t("Source credit")}
              <input
                maxLength={80}
                value={project.author ?? ""}
                onChange={(e) => edit({ ...project, author: e.target.value })}
              />
            </label>
            <label>
              {t("Reuse licence")}
              <select
                value={project.licence ?? "reserved"}
                onChange={(e) =>
                  edit({
                    ...project,
                    licence: e.target.value as MusicProject["licence"],
                  })
                }
              >
                <option value="reserved">
                  {t("No reuse licence granted")}
                </option>
                <option value="CC0-1.0">{t("CC0 1.0")}</option>
                <option value="CC-BY-4.0">{t("CC BY 4.0")}</option>
              </select>
            </label>
            <label>
              {t("Visibility")}
              <select
                value={visibility}
                onChange={(e) => {
                  setVisibility(e.target.value);
                  requestKey.current = crypto.randomUUID();
                }}
              >
                <option value="public">
                  {t("Public · appears in Explore")}
                </option>
                <option value="unlisted">
                  {t("Unlisted · anyone with the link")}
                </option>
                <option value="private">{t("Private · only you")}</option>
              </select>
            </label>
            <p>
              {t(
                "Publish music you can share, and keep source credits. The library licence does not grant rights to imported music.",
              )}
            </p>
            <Account />
            {artists.length > 0 && (
              <label>
                {t("Publish as")}
                <select
                  value={artistId}
                  onChange={(e) => {
                    setArtistId(e.target.value);
                    requestKey.current = crypto.randomUUID();
                  }}
                >
                  {artists.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.displayName || p.handle || t("Artist")}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <Button
              disabled={busy || !project.title.trim()}
              onClick={() => void publish()}
            >
              {t(published ? "Publish a new revision" : "Publish song")}
            </Button>
            {published && (
              <>
                <Link href={`/p/${published.id}`}>
                  {t("Open publication")} ↗
                </Link>
                <Button
                  onClick={() =>
                    void startRender(published.id, "full").catch((error) =>
                      setNotice(error.message),
                    )
                  }
                >
                  {t("Prepare full download")}
                </Button>
              </>
            )}
            {job && (
              <p role="status">
                {t(job.mp3Status === "queued" ? "Encoding MP3…" : job.status)}{" "}
                {job.mp3Status !== "queued" &&
                  `${Math.round(job.progress * 100)}%`}{" "}
                {job.error && t.source(job.error)}{" "}
                {job.mp3Error && errorText(job.mp3Error)}{" "}
                {job.mp3Url && <a href={job.mp3Url}>{t("Download MP3")}</a>}
                {job.audio && (
                  <a href={job.audio}>{t("Download pinned audio")}</a>
                )}
                {(["queued", "rendering", "cancelling"].includes(job.status) ||
                  job.mp3Status === "queued") && (
                  <Button
                    onClick={() =>
                      void fetch(`/api/v1/jobs/${job.id}`, {
                        method: "DELETE",
                      }).then(() => setJob({ ...job, status: "cancelling" }))
                    }
                  >
                    {t("Cancel")}
                  </Button>
                )}
              </p>
            )}
          </section>
        )}
        <p role="status" className="create-notice">
          {t.source(notice)}
        </p>
        <section className="create-api">
          <h2>{t("Take the music into your game.")}</h2>
          <code>npm i chipvoice</code>
          <pre>{`import { ProjectPlayer } from 'chipvoice';\nconst player = new ProjectPlayer();\nawait player.load(project);\n// In your Play button handler:\nawait player.play();`}</pre>
          <Link href="/docs">{t("SDK examples and HTTP API")} →</Link>
        </section>
      </main>
      {!embedded && <SiteFooter />}
    </>
  );
}
