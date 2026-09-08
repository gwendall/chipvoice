import { projectRoute } from "@/lib/project-http";
import { listProfiles, createProfile } from "@/lib/projects";
export const GET = projectRoute(
  async (_, caller) => ({ items: await listProfiles(caller.userId!) }),
  true,
);
export const POST = projectRoute(
  async (_, caller) => createProfile(caller.userId!),
  true,
);
