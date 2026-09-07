import { createHash } from "node:crypto";
import { parseProject, type MusicProject } from "chipvoice";
import { db, newId } from "./db";
export class ProjectHttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}
export type Visibility = "public" | "unlisted" | "private";
export interface Profile {
  id: string;
  handle: string | null;
  displayName: string;
  bio: string;
}
export interface Publication {
  id: string;
  parentId: string | null;
  rootId: string;
  title: string;
  chip: string;
  tags: string[];
  visibility: Visibility;
  createdAt: number;
  contentHash: string;
  profile: Profile;
  favourites: number;
  favourited: boolean;
  owned: boolean;
  renditions?: { id: string; kind: string; status: string; engine: string }[];
  project?: MusicProject;
}
const digest = (text: string) =>
  createHash("sha256").update(text).digest("hex");
/** Stable serialization makes request retries independent of JSON key ordering. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (value && typeof value === "object")
    return (
      "{" +
      Object.keys(value)
        .sort()
        .map(
          (key) =>
            JSON.stringify(key) +
            ":" +
            canonical((value as Record<string, unknown>)[key]),
        )
        .join(",") +
      "}"
    );
  return JSON.stringify(value);
}
export async function admitProject(scope: string, limit: number) {
  const client = await db(),
    now = Date.now(),
    window = Math.floor(now / 60000);
  await client.execute({
    sql: "delete from project_admission where window < ?",
    args: [window - 2],
  });
  const result = await client.execute({
    sql: `insert into project_admission(scope,window,count) values(?,?,1) on conflict(scope) do update set window=excluded.window,count=case when project_admission.window=excluded.window then project_admission.count+1 else 1 end where project_admission.window<>excluded.window or project_admission.count<? returning count`,
    args: [digest(scope), window, limit],
  });
  if (!result.rows.length)
    throw new ProjectHttpError(
      429,
      "rate_limited",
      "Please wait before trying again",
    );
}
export async function ensureProfile(userId: string): Promise<Profile> {
  const client = await db();
  await client.execute({
    sql: "insert into profiles(id,user_id,created_at) values(?,?,?) on conflict(user_id) do nothing",
    args: [newId(), userId, Date.now()],
  });
  const result = await client.execute({
    sql: "select * from profiles where user_id=?",
    args: [userId],
  });
  return profile(result.rows[0]);
}
function profile(row: Record<string, unknown>): Profile {
  return {
    id: String(row.profile_id ?? row.id),
    handle: row.handle ? String(row.handle) : null,
    displayName: String(row.display_name ?? ""),
    bio: String(row.bio ?? ""),
  };
}
export async function editProfile(
  userId: string,
  input: { handle: string; displayName: string; bio: string },
) {
  const handle = input.handle.toLowerCase().trim();
  if (
    !/^[a-z][a-z0-9_]{2,23}$/.test(handle) ||
    [
      "admin",
      "chipvoice",
      "support",
      "api",
      "me",
      "new",
      "studio",
      "explore",
    ].includes(handle)
  )
    throw new ProjectHttpError(
      422,
      "invalid_handle",
      "Use 3–24 lowercase letters, numbers or underscores, starting with a letter",
    );
  if (input.displayName.length > 60 || input.bio.length > 500)
    throw new ProjectHttpError(
      422,
      "invalid_profile",
      "Profile text is too long",
    );
  await ensureProfile(userId);
  const client = await db();
  try {
    await client.execute({
      sql: "update profiles set handle=?,display_name=?,bio=? where user_id=?",
      args: [handle, input.displayName.trim(), input.bio.trim(), userId],
    });
  } catch (error) {
    if (String(error).includes("UNIQUE"))
      throw new ProjectHttpError(409, "handle_taken", "This username is taken");
    throw error;
  }
  return ensureProfile(userId);
}
export async function profileByHandle(handle: string) {
  const r = await (
    await db()
  ).execute({
    sql: "select * from profiles where handle=? collate nocase",
    args: [handle],
  });
  return r.rows[0] ? profile(r.rows[0]) : null;
}
const SELECT = `select p.*,f.id as profile_id,f.handle,f.display_name,f.bio,(select count(*) from favourites v where v.project_id=p.id) as favourite_count from projects p join profiles f on f.user_id=p.user_id`;
function present(
  row: Record<string, unknown>,
  viewer: string | null,
  document = false,
): Publication {
  return {
    id: String(row.id),
    parentId: row.parent_id ? String(row.parent_id) : null,
    rootId: String(row.root_id),
    title: String(row.title),
    chip: String(row.chip),
    tags: JSON.parse(String(row.tags)),
    visibility: row.visibility as Visibility,
    createdAt: Number(row.created_at),
    contentHash: String(row.content_hash),
    profile: profile(row),
    favourites: Number(row.favourite_count ?? 0),
    favourited: !!row.favourited,
    owned: row.user_id === viewer,
    ...(document ? { project: parseProject(String(row.document)) } : {}),
  };
}
export async function getProject(
  id: string,
  viewer: string | null = null,
): Promise<Publication | null> {
  const result = await (
    await db()
  ).execute({
    sql:
      SELECT +
      " where p.id=? and p.deleted_at is null and (p.visibility<>'private' or p.user_id=?)",
    args: [id, viewer],
  });
  const row = result.rows[0];
  if (!row) return null;
  if (viewer) {
    const fav = await (
      await db()
    ).execute({
      sql: "select 1 from favourites where project_id=? and user_id=?",
      args: [id, viewer],
    });
    row.favourited = fav.rows.length ? 1 : 0;
  }
  const publication = present(row, viewer, true);
  const jobs = await (
    await db()
  ).execute({
    sql: "select id,kind,status,engine from project_jobs where project_id=?",
    args: [id],
  });
  publication.renditions = jobs.rows.map((j) => ({
    id: String(j.id),
    kind: String(j.kind),
    status: String(j.status),
    engine: String(j.engine),
  }));
  return publication;
}
export async function publishProject(
  userId: string,
  input: {
    project: unknown;
    visibility: Visibility;
    parentId?: string;
    requestKey: string;
  },
) {
  if (!["public", "unlisted", "private"].includes(input.visibility))
    throw new ProjectHttpError(
      422,
      "invalid_visibility",
      "Choose public, unlisted or private",
    );
  if (!/^[a-zA-Z0-9_-]{8,80}$/.test(input.requestKey))
    throw new ProjectHttpError(
      422,
      "invalid_request_key",
      "A request key of 8–80 letters, digits, underscores or hyphens is required",
    );
  const project = parseProject(input.project),
    document = canonical(project);
  if (Buffer.byteLength(document) > 4 * 1024 * 1024)
    throw new ProjectHttpError(
      413,
      "project_too_large",
      "Publications support up to 4 MB of musical data",
    );
  const hash = digest(document),
    client = await db();
  const existing = await client.execute({
    sql: "select * from projects where user_id=? and request_key=?",
    args: [userId, input.requestKey],
  });
  if (existing.rows[0]) {
    const row = existing.rows[0];
    if (
      row.content_hash !== hash ||
      row.visibility !== input.visibility ||
      (row.parent_id ?? null) !== (input.parentId ?? null) ||
      row.deleted_at !== null
    )
      throw new ProjectHttpError(
        409,
        "request_key_reused",
        "This request key belongs to a different publication",
      );
    return (await getProject(String(row.id), userId))!;
  }
  await admitProject(`publish:${userId}`, 10);
  await ensureProfile(userId);
  const parent = input.parentId
    ? await getProject(input.parentId, userId)
    : null;
  if (input.parentId && !parent)
    throw new ProjectHttpError(
      404,
      "parent_not_found",
      "Parent publication is unavailable",
    );
  // A private source cannot be made public by somebody without access.
  const id = newId(),
    now = Date.now();
  await client.execute({
    sql: `insert into projects(id,user_id,parent_id,root_id,document,content_hash,title,chip,tags,visibility,created_at,request_key) values(?,?,?,?,?,?,?,?,?,?,?,?) on conflict(user_id,request_key) do nothing`,
    args: [
      id,
      userId,
      parent?.id ?? null,
      parent?.rootId ?? id,
      document,
      hash,
      project.title,
      project.settings.chip,
      JSON.stringify(project.tags ?? []),
      input.visibility,
      now,
      input.requestKey,
    ],
  });
  const saved = await client.execute({
    sql: "select * from projects where user_id=? and request_key=?",
    args: [userId, input.requestKey],
  });
  const row = saved.rows[0];
  if (
    row.content_hash !== hash ||
    row.visibility !== input.visibility ||
    (row.parent_id ?? null) !== (input.parentId ?? null)
  )
    throw new ProjectHttpError(
      409,
      "request_key_reused",
      "Concurrent request used a different document",
    );
  return (await getProject(String(row.id), userId))!;
}
export async function listProjects(
  query: {
    q?: string;
    chip?: string;
    tag?: string;
    handle?: string;
    mine?: boolean;
    favourites?: boolean;
    sort?: string;
    cursor?: string;
  },
  viewer: string | null,
) {
  const client = await db(),
    where = ["p.deleted_at is null"],
    args: (string | number | null)[] = [];
  if (query.mine && !query.favourites) {
    if (!viewer)
      throw new ProjectHttpError(401, "sign_in", "Sign in to see your library");
    where.push("p.user_id=?");
    args.push(viewer);
  } else where.push("p.visibility='public'");
  if (query.q) {
    where.push(
      "(p.title like ? escape '\\' or f.handle like ? escape '\\' or f.display_name like ? escape '\\')",
    );
    const q = "%" + query.q.slice(0, 100).replace(/[\\%_]/g, "\\$&") + "%";
    args.push(q, q, q);
  }
  if (query.chip) {
    where.push("p.chip=?");
    args.push(query.chip);
  }
  if (query.handle) {
    where.push("f.handle=? collate nocase");
    args.push(query.handle);
  }
  if (query.tag) {
    where.push("exists(select 1 from json_each(p.tags) where value=?)");
    args.push(query.tag.slice(0, 24));
  }
  if (query.favourites) {
    if (!viewer)
      throw new ProjectHttpError(401, "sign_in", "Sign in to see favourites");
    where.push(
      "exists(select 1 from favourites v where v.project_id=p.id and v.user_id=?)",
    );
    args.push(viewer);
  }
  const popular = query.sort === "popular";
  // A fixed snapshot keeps pagination deterministic while new songs/favourites arrive.
  let snapshot = Date.now(),
    lastTime: number | null = null,
    lastId = "",
    lastCount = 0;
  if (query.cursor) {
    try {
      const c = JSON.parse(Buffer.from(query.cursor, "base64url").toString());
      if (
        !Number.isSafeInteger(c.snapshot) ||
        !Number.isSafeInteger(c.time) ||
        typeof c.id !== "string" ||
        !Number.isSafeInteger(c.count) ||
        c.snapshot > Date.now() ||
        c.snapshot < 0
      )
        throw Error();
      snapshot = c.snapshot;
      lastTime = c.time;
      lastId = c.id;
      lastCount = c.count;
    } catch {
      throw new ProjectHttpError(400, "invalid_cursor", "Invalid page cursor");
    }
  }
  where.push("p.created_at<=?");
  args.push(snapshot);
  const count = `(select count(*) from favourites v where v.project_id=p.id and v.created_at>${snapshot - 7 * 86400000} and v.created_at<=${snapshot})`;
  if (lastTime !== null) {
    where.push(
      popular
        ? `(${count}<? or (${count}=? and (p.created_at<? or (p.created_at=? and p.id<?))))`
        : "(p.created_at<? or (p.created_at=? and p.id<?))",
    );
    if (popular) args.push(lastCount, lastCount);
    args.push(lastTime, lastTime, lastId);
  }
  // Keep count projection beside SELECT, before FROM, without repeating query filters.
  const select = SELECT.replace(
    " from projects p",
    `, ${count} as weekly_count, exists(select 1 from favourites v where v.project_id=p.id and v.user_id=?) as favourited from projects p`,
  );
  const result = await client.execute({
    sql:
      select +
      " where " +
      where.join(" and ") +
      ` order by ${popular ? "weekly_count desc," : ""}p.created_at desc,p.id desc limit 25`,
    args: [viewer, ...args],
  });
  const page = result.rows.slice(0, 24),
    last = page.at(-1);
  return {
    items: page.map((row) => present(row, viewer)),
    cursor:
      result.rows.length > 24 && last
        ? Buffer.from(
            JSON.stringify({
              snapshot,
              time: Number(last.created_at),
              id: last.id,
              count: Number(last.weekly_count),
            }),
          ).toString("base64url")
        : null,
  };
}
export async function withdrawProject(id: string, userId: string) {
  const client = await db();
  const r = await client.execute({
    sql: "update projects set deleted_at=? where id=? and user_id=? and deleted_at is null returning id",
    args: [Date.now(), id, userId],
  });
  if (!r.rows.length)
    throw new ProjectHttpError(404, "not_found", "Publication not found");
  await client.execute({
    sql: "update project_jobs set status='cancelled' where project_id=? and status in ('queued','rendering')",
    args: [id],
  });
}
export async function setFavourite(
  id: string,
  userId: string,
  enabled: boolean,
) {
  const publication = await getProject(id, userId);
  if (!publication || publication.visibility !== "public")
    throw new ProjectHttpError(404, "not_found", "Public song not found");
  if (publication.owned)
    throw new ProjectHttpError(
      422,
      "own_song",
      "You cannot favourite your own publication",
    );
  const client = await db();
  if (enabled)
    await client.execute({
      sql: "insert into favourites(project_id,user_id,created_at) values(?,?,?) on conflict do nothing",
      args: [id, userId, Date.now()],
    });
  else
    await client.execute({
      sql: "delete from favourites where project_id=? and user_id=?",
      args: [id, userId],
    });
  return getProject(id, userId);
}
