import { projectRoute, readProjectBody, objectBody } from "@/lib/project-http";
import {
  ensureProfile,
  ownedProfile,
  editProfile,
  admitProject,
  ProjectHttpError,
} from "@/lib/projects";
export const GET = projectRoute(
  async (_, caller) =>
    caller.agent
      ? ownedProfile(caller.userId!, caller.agent.profileId)
      : ensureProfile(caller.userId!),
  true,
);
export const PUT = projectRoute(async (request, caller) => {
  const body = objectBody(await readProjectBody(request, 8192), [
    "handle",
    "displayName",
    "bio",
    "avatar",
  ]);
  if (
    typeof body.handle !== "string" ||
    typeof body.displayName !== "string" ||
    typeof body.bio !== "string"
  )
    throw new ProjectHttpError(
      422,
      "invalid_profile",
      "Handle, display name and biography must be text",
    );
  await admitProject(`profile:${caller.userId}`, 10);
  return editProfile(
    caller.userId!,
    body as { handle: string; displayName: string; bio: string },
    caller.agent?.profileId,
  );
}, true);
