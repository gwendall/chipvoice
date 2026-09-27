// Manages the closed beta's invitations to prompt composition (decision 42).
// Run it from apps/web:
//
//   node scripts/composition-invites.mjs list
//   node scripts/composition-invites.mjs add <email> [note]
//   node scripts/composition-invites.mjs remove <email>
//
// It writes to whichever database the environment names, exactly as the site
// does (src/lib/db.ts): a local file by default, production only with
// VERCEL_ENV=production and the production Turso variables, for example
//
//   vercel env pull .env.production.local --environment=production
//   node --env-file=.env.production.local scripts/composition-invites.mjs add someone@example.org "beta, wave 1"
//
// and delete that file afterwards. An invitation names an email, so it can be
// sent before the person has an account; it takes effect at their next request.
import { rmSync } from "node:fs";
import { build } from "../../../packages/chipvoice/node_modules/esbuild/lib/main.js";

const [command, rawEmail, note] = process.argv.slice(2);
const email = rawEmail?.toLowerCase().trim();
if (!["list", "add", "remove"].includes(command) || (command !== "list" && !email?.includes("@"))) {
  console.error("usage: composition-invites.mjs list | add <email> [note] | remove <email>");
  process.exit(2);
}
const out = "generated/composition-invites-db.mjs";
await build({ stdin: { contents: "export * from './src/lib/db';", resolveDir: process.cwd() }, outfile: out, bundle: true, platform: "node", format: "esm", packages: "external", logLevel: "silent" });
try {
  const { db } = await import(`${process.cwd()}/${out}`);
  const client = await db();
  console.log(`database: ${process.env.VERCEL_ENV === "production" ? "production" : "local or development"}`);
  if (command === "add") {
    await client.execute({ sql: "insert into composition_invites (email,created_at,note) values (?,?,?) on conflict(email) do update set note=coalesce(excluded.note,composition_invites.note)", args: [email, Date.now(), note ?? null] });
    console.log(`invited ${email}`);
  } else if (command === "remove") {
    const result = await client.execute({ sql: "delete from composition_invites where email=?", args: [email] });
    console.log(result.rowsAffected ? `removed ${email}` : `${email} was not invited`);
  } else {
    const rows = (await client.execute(`select i.email,i.created_at,i.note,u.id is not null as has_account from composition_invites i left join users u on u.email=i.email order by i.created_at`)).rows;
    for (const row of rows) console.log(`${new Date(Number(row.created_at)).toISOString().slice(0, 10)}  ${row.email}${row.has_account ? "" : "  (no account yet)"}${row.note ? `  - ${row.note}` : ""}`);
    console.log(`${rows.length} invitation${rows.length === 1 ? "" : "s"}`);
  }
  client.close();
} finally {
  rmSync(out, { force: true });
}
