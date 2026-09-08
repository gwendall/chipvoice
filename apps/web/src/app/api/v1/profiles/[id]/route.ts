import { projectRoute, readProjectBody, objectBody } from "@/lib/project-http";
import { editProfile, ProjectHttpError, admitProject } from "@/lib/projects";
export async function PUT(r: Request, c: { params: Promise<{ id: string }> }) {
  const { id } = await c.params;
  return projectRoute(async (request, caller) => {
    const b = objectBody(await readProjectBody(request, 8192), [
      "handle",
      "displayName",
      "bio",
      "avatar",
    ]);
    if (
      typeof b.handle !== "string" ||
      typeof b.displayName !== "string" ||
      typeof b.bio !== "string"
    )
      throw new ProjectHttpError(
        422,
        "invalid_profile",
        "Supply handle, display name and biography",
      );
    await admitProject(`profile:${caller.userId}`, 10);
    return editProfile(
      caller.userId!,
      b as {
        handle: string;
        displayName: string;
        bio: string;
        avatar?: unknown;
      },
      id,
    );
  }, true)(r);
}
