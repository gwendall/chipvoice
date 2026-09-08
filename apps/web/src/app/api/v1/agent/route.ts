import { projectRoute } from "@/lib/project-http";
import { ownedProfile, ProjectHttpError } from "@/lib/projects";
export const GET = projectRoute(async (_, caller) => {
  if (!caller.agent)
    throw new ProjectHttpError(
      403,
      "agent_required",
      "Use an agent credential",
    );
  return {
    ...caller.agent,
    profile: await ownedProfile(caller.userId!, caller.agent.profileId),
  };
}, true);
