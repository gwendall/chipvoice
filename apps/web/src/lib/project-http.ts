import { ProjectValidationError } from "chipvoice";
import { createRoute, readBody, objectBody as sharedObjectBody } from "web-kit/http";
import { authorizeAgent } from "./agents";
import { identify, type Caller } from "./auth";
import { hasDatabase } from "./db";
import { bearerChallenge } from "./oauth";

/**
 * chipvoice's own configuration of `web-kit/http`'s `createRoute`: its
 * `identify`, its route-to-scope policy (`authorizeAgent`, which stays here
 * because "artist" scopes are chipvoice's own concept), its readiness check
 * and its `ProjectValidationError` mapping (chipvoice SDK-specific, so it
 * cannot live in the generic package). Every route handler across this app
 * imports `projectRoute` from here, unchanged in shape from before this
 * package existed.
 */
export const projectRoute = createRoute<Caller>({
  identify,
  ready: hasDatabase,
  unavailable: { code: "unavailable", message: "Publication service is unavailable" },
  authorize: authorizeAgent,
  bearerChallenge,
  signIn: { code: "sign_in", message: "Sign in to manage your publications" },
  fallback: {
    code: "unavailable",
    message: "Could not complete this request. Your local draft is safe.",
  },
  mapError: (error) =>
    error instanceof ProjectValidationError
      ? Response.json({ error: "invalid_project", issues: error.issues }, { status: 422 })
      : null,
});

export const readProjectBody = readBody;
export const objectBody = sharedObjectBody;
