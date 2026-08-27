import type { Issue } from "chipvoice";
import { check as checkSong } from "./songs";
import { cleanAuthor, cleanTitle } from "./text";
import type { SongInput } from "./schema";

/**
 * Everything that decides whether a song can be stored, in one place.
 *
 * It was in two: the notes were checked by `/api/validate` and the title only
 * by `/api/songs`. So a caller could be told its song was fine and then be
 * refused at the moment it committed - which is the exact failure the validate
 * route exists to prevent, and worse than having no validate route at all,
 * because it teaches a caller to trust an answer that is incomplete.
 */
export interface FullCheck {
  ok: boolean;
  issues: Issue[];
  measured: ReturnType<typeof checkSong>["measured"];
  /** The cleaned values, ready to store. */
  title: string;
  author: string;
}

export function checkAll(input: SongInput): FullCheck {
  const issues: Issue[] = [];

  const title = cleanTitle(input.title);
  if (!title.ok) {
    issues.push({ level: "error", track: "title", message: title.message!, silent: false });
  }
  const author = cleanAuthor(input.author);
  if (!author.ok) {
    issues.push({ level: "error", track: "author", message: author.message!, silent: false });
  }

  const song = checkSong(input);
  issues.push(...song.issues);

  return {
    ok: title.ok && author.ok && song.ok,
    issues,
    measured: song.measured,
    title: title.value,
    author: author.value,
  };
}
