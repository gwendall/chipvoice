import { createHash } from "node:crypto";
import { parseProject, type MusicProject } from "chipvoice";
import { SITE } from "./songs";
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
  kind: "human" | "agent";
  avatar: { palette: number; variant: number } | null;
  url: string | null;
  avatarUrl: string;
}
export interface CompositionOrigin { method: "direct" | "prompt" | "prompt-derived"; model: string | null }
export interface Publication {
  origin: CompositionOrigin;
  id: string;
  url: string;
  coverUrl: string;
  variants?: { id: string; chip: string; url: string }[];
  generation?: { id: string; prompt: string; model: string };
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
  renditions?: {
    id: string;
    kind: string;
    status: string;
    engine: string;
    mp3Bytes: number;
  }[];
  project?: MusicProject;
}
const digest = (text: string) =>
  createHash("sha256").update(text).digest("hex");
/** Stable serialization makes request retries independent of JSON key ordering. */
export function canonical(value: unknown): string {
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
    sql: "insert into profiles(id,user_id,created_at,is_default) values(?,?,?,1) on conflict(user_id) where is_default=1 do nothing",
    args: [newId(), userId, Date.now()],
  });
  const result = await client.execute({
    sql: "select * from profiles where user_id=? and is_default=1",
    args: [userId],
  });
  return profile(result.rows[0]);
}
export function profile(row: Record<string, unknown>): Profile {
  return {
    id: String(row.profile_id ?? row.id),
    handle: row.handle ? String(row.handle) : null,
    displayName: String(row.display_name ?? ""),
    bio: String(row.bio ?? ""),
    kind: row.kind === "agent" ? "agent" : "human",
    avatar: row.avatar ? JSON.parse(String(row.avatar)) : null,
    url: row.handle ? `${SITE}/u/${row.handle}` : null,
    avatarUrl: `${SITE}/api/v1/profiles/${row.profile_id ?? row.id}/avatar`,
  };
}
export async function editProfile(
  userId: string,
  input: { handle: string; displayName: string; bio: string; avatar?: unknown },
  profileId?: string,
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
  const current = profileId
    ? await ownedProfile(userId, profileId)
    : await ensureProfile(userId);
  const avatar =
    input.avatar === undefined ? current.avatar : validateAvatar(input.avatar);
  const client = await db();
  try {
    await client.execute({
      sql: "update profiles set handle=?,display_name=?,bio=?,avatar=? where user_id=? and id=?",
      args: [
        handle,
        input.displayName.trim(),
        input.bio.trim(),
        avatar ? JSON.stringify(avatar) : null,
        userId,
        current.id,
      ],
    });
  } catch (error) {
    if (String(error).includes("UNIQUE"))
      throw new ProjectHttpError(409, "handle_taken", "This username is taken");
    throw error;
  }
  return ownedProfile(userId, current.id);
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
const SELECT = `select p.*,f.id as profile_id,f.handle,f.display_name,f.bio,f.kind,f.avatar,(select count(*) from favourites v where v.project_id=p.id) as favourite_count from projects p join profiles f on f.id=p.profile_id`;
function present(
  row: Record<string, unknown>,
  viewer: Viewer,
  document = false,
): Publication {
  return {
    origin: { method: row.origin === "prompt" ? "prompt" : row.origin === "prompt-derived" ? "prompt-derived" : "direct", model: row.origin_model ? String(row.origin_model) : null },
    id: String(row.id),
    url: `${SITE}/p/${row.id}`,
    coverUrl: `${SITE}/api/v1/projects/${row.id}/cover`,
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
    owned: owns(row, viewer),
    ...(document ? { project: parseProject(String(row.document)) } : {}),
  };
}
export async function getProject(
  id: string,
  viewer: Viewer = null,
): Promise<Publication | null> {
  const result = await (
    await db()
  ).execute({
    sql:
      SELECT +
      ` where p.id=? and p.deleted_at is null and (p.visibility<>'private' or (p.user_id=? and (? is null or p.profile_id=?)))`,
    args: [
      id,
      viewerUser(viewer),
      viewerProfile(viewer),
      viewerProfile(viewer),
    ],
  });
  const row = result.rows[0];
  if (!row) return null;
  if (viewer && !viewerProfile(viewer)) {
    const fav = await (
      await db()
    ).execute({
      sql: "select 1 from favourites where project_id=? and user_id=?",
      args: [id, viewerUser(viewer)],
    });
    row.favourited = fav.rows.length ? 1 : 0;
  }
  const publication = present(row, viewer, true);
  const jobs = await (
    await db()
  ).execute({
    sql: "select id,kind,status,engine,mp3_bytes from project_jobs where project_id=?",
    args: [id],
  });
  publication.renditions = jobs.rows.map((j) => ({
    id: String(j.id),
    kind: String(j.kind),
    status: String(j.status),
    engine: String(j.engine),
    mp3Bytes: Number(j.mp3_bytes ?? 0),
  }));
  const variants = await (
    await db()
  ).execute({
    sql: `select id,chip from projects where profile_id=? and composition_hash=? and origin=? and origin_model is ? and deleted_at is null and (visibility='public' or id=? or (user_id=? and (? is null or profile_id=?))) order by created_at desc,id desc`,
    args: [
      row.profile_id,
      row.composition_hash,
      row.origin, row.origin_model,
      id,
      viewerUser(viewer),
      viewerProfile(viewer),
      viewerProfile(viewer),
    ],
  });
  const seen = new Set<string>();
  publication.variants = variants.rows
    .filter((v) => {
      const chip = String(v.chip);
      if (seen.has(chip)) return false;
      seen.add(chip);
      return true;
    })
    .map((v) => ({
      id: String(v.id),
      chip: String(v.chip),
      url: `${SITE}/p/${v.id}`,
    }));
  if (publication.owned) {
    const generation = (await (await db()).execute({
      sql: "select id,request,model from generations where project_id=? and user_id=? and profile_id=? limit 1",
      args: [id, viewerUser(viewer), row.profile_id],
    })).rows[0];
    if (generation) publication.generation = {
      id: String(generation.id), prompt: String(JSON.parse(String(generation.request)).prompt), model: String(generation.model),
    };
  }
  return publication;
}
export async function publishProject(
  userId: string,
  input: {
    project: unknown;
    visibility: Visibility;
    parentId?: string;
    requestKey: string;
    profileId?: string;
    viewer?: Viewer;
    origin?: CompositionOrigin;
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
  const artist = input.profileId
    ? await ownedProfile(userId, input.profileId)
    : await ensureProfile(userId);
  const hash = digest(document),
    client = await db();
  const existing = await client.execute({
    sql: "select * from projects where user_id=? and request_key=?",
    args: [userId, input.requestKey],
  });
  if (existing.rows[0]) {
    const row = existing.rows[0];
    if (
      row.profile_id !== artist.id ||
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
    ? await getProject(input.parentId, input.viewer ?? userId)
    : null;
  if (input.parentId && !parent)
    throw new ProjectHttpError(
      404,
      "parent_not_found",
      "Parent publication is unavailable",
    );
  const origin = input.origin ?? (parent && parent.origin.method !== "direct" ? {
    method: digest(canonical(project.source)) === digest(canonical(parent.project!.source)) ? parent.origin.method : "prompt-derived" as const,
    model: parent.origin.model,
  } : { method: "direct" as const, model: null });
  // A private source cannot be made public by somebody without access.
  const id = newId(),
    now = Date.now();
  await client.execute({
    sql: `insert into projects(id,user_id,parent_id,root_id,document,content_hash,title,chip,tags,visibility,created_at,request_key,profile_id,composition_hash,origin,origin_model) values(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) on conflict(user_id,request_key) do nothing`,
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
      artist.id,
      digest(canonical(project.source)),
      origin.method, origin.model,
    ],
  });
  const saved = await client.execute({
    sql: "select * from projects where user_id=? and request_key=?",
    args: [userId, input.requestKey],
  });
  const row = saved.rows[0];
  if (
    row.profile_id !== artist.id ||
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
    group?: boolean;
    q?: string;
    chip?: string;
    tag?: string;
    handle?: string;
    mine?: boolean;
    favourites?: boolean;
    sort?: string;
    cursor?: string;
  },
  viewer: Viewer,
) {
  const client = await db(),
    where = ["p.deleted_at is null"],
    args: (string | number | null)[] = [];
  if (query.mine && !query.favourites) {
    if (!viewer)
      throw new ProjectHttpError(401, "sign_in", "Sign in to see your library");
    where.push("p.user_id=?");
    args.push(viewerUser(viewer));
    if (viewerProfile(viewer)) {
      where.push("p.profile_id=?");
      args.push(viewerProfile(viewer));
    }
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
    args.push(viewerUser(viewer));
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
  const filterCount = where.length;
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
    sql: query.group
      ? `select * from (select base.*,row_number() over(partition by profile_id,coalesce(composition_hash,id),origin,origin_model order by ${popular ? "weekly_count desc," : ""}created_at desc,id desc) as variant_rank from (${select} where ${where.slice(0, filterCount).join(" and ")}) base) p where variant_rank=1${where.length > filterCount ? " and " + where.slice(filterCount).join(" and ") : ""} order by ${popular ? "weekly_count desc," : ""}p.created_at desc,p.id desc limit 25`
      : select +
        " where " +
        where.join(" and ") +
        ` order by ${popular ? "weekly_count desc," : ""}p.created_at desc,p.id desc limit 25`,
    args: [viewerProfile(viewer) ? null : viewerUser(viewer), ...args],
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
export async function withdrawProject(id: string, viewer: Viewer) {
  const client = await db();
  const found = await getProject(id, viewer);
  if (!found?.owned)
    throw new ProjectHttpError(404, "not_found", "Publication not found");
  const r = await client.execute({
    sql: "update projects set deleted_at=? where id=? and user_id=? and deleted_at is null returning id",
    args: [Date.now(), id, viewerUser(viewer)],
  });
  if (!r.rows.length)
    throw new ProjectHttpError(404, "not_found", "Publication not found");
  await client.execute({
    sql: "update project_jobs set status=case when status='rendering' then 'cancelling' else 'cancelled' end where project_id=? and status in ('queued','rendering')",
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

/** An agent sees private resources only within its explicitly authorized artist. */
export type Viewer = string | null | { userId: string; profileId: string };
export const viewerUser = (viewer: Viewer) =>
  typeof viewer === "object" ? (viewer?.userId ?? null) : viewer;
export const viewerProfile = (viewer: Viewer) =>
  typeof viewer === "object" ? (viewer?.profileId ?? null) : null;
function owns(row: Record<string, unknown>, viewer: Viewer) {
  return (
    row.user_id === viewerUser(viewer) &&
    (!viewerProfile(viewer) || row.profile_id === viewerProfile(viewer))
  );
}
export async function ownedProfile(
  userId: string,
  id: string,
): Promise<Profile> {
  const result = await (
    await db()
  ).execute({
    sql: "select * from profiles where id=? and user_id=?",
    args: [id, userId],
  });
  if (!result.rows[0])
    throw new ProjectHttpError(404, "not_found", "Artist not found");
  return profile(result.rows[0]);
}
export async function listProfiles(userId: string) {
  await ensureProfile(userId);
  return (
    await (
      await db()
    ).execute({
      sql: "select * from profiles where user_id=? order by is_default desc,created_at,id",
      args: [userId],
    })
  ).rows.map(profile);
}
export async function createProfile(userId: string) {
  await ensureProfile(userId);
  await admitProject(`artist:${userId}`, 3);
  const client = await db(),
    id = newId();
  const r = await client.execute({
    sql: `insert into profiles(id,user_id,created_at,kind) select ?,?,?,'agent' where (select count(*) from profiles where user_id=?)<20 returning *`,
    args: [id, userId, Date.now(), userId],
  });
  if (!r.rows.length)
    throw new ProjectHttpError(
      429,
      "artist_limit",
      "An account supports up to 20 artists",
    );
  return profile(r.rows[0]);
}
export function validateAvatar(value: unknown): Profile["avatar"] {
  if (value === null) return null;
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new ProjectHttpError(
      422,
      "invalid_avatar",
      "Choose a palette and portrait variant",
    );
  const v = value as Record<string, unknown>;
  if (
    Object.keys(v).some((k) => !["palette", "variant"].includes(k)) ||
    !Number.isInteger(v.palette) ||
    Number(v.palette) < 0 ||
    Number(v.palette) > 3 ||
    !Number.isInteger(v.variant) ||
    Number(v.variant) < 0 ||
    Number(v.variant) > 15
  )
    throw new ProjectHttpError(
      422,
      "invalid_avatar",
      "Palette must be 0–3; variant must be 0–15",
    );
  return { palette: Number(v.palette), variant: Number(v.variant) };
}

/** Publishing changes visibility only; the score, author and rendered bytes stay pinned. */
export async function setProjectVisibility(id: string, viewer: Viewer, visibility: unknown) {
  if (!["private", "unlisted", "public"].includes(String(visibility)))
    throw new ProjectHttpError(422, "invalid_visibility", "Choose private, unlisted or public");
  const current = await getProject(id, viewer);
  if (!current?.owned) throw new ProjectHttpError(404, "not_found", "Your publication was not found");
  await (await db()).execute({
    sql: "update projects set visibility=? where id=? and user_id=? and deleted_at is null and (? is null or profile_id=?)",
    args: [String(visibility), id, viewerUser(viewer), viewerProfile(viewer), viewerProfile(viewer)],
  });
  return getProject(id, viewer);
}
