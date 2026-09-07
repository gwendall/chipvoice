import { ProjectHttpError } from "@/lib/projects";
import { validateProject } from "chipvoice";
import { readProjectBody } from "@/lib/project-http";
export async function POST(request: Request) {
  try {
    const result = validateProject(await readProjectBody(request));
    return Response.json(result, { status: result.ok ? 200 : 422 });
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof ProjectHttpError ? error.code : "invalid_request",
      },
      { status: error instanceof ProjectHttpError ? error.status : 400 },
    );
  }
}
