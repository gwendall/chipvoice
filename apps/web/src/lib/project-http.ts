import { authorizeAgent } from "./agents";
import { ProjectValidationError } from "chipvoice";
import { identify, type Caller } from "./auth";
import { ProjectHttpError } from "./projects";
import { hasDatabase } from "./db";
export async function readProjectBody(
  request: Request,
  max = 4 * 1024 * 1024,
): Promise<unknown> {
  if (Number(request.headers.get("content-length") ?? 0) > max)
    throw new ProjectHttpError(413, "too_large", "Request is too large");
  const reader = request.body?.getReader();
  if (!reader)
    throw new ProjectHttpError(400, "invalid_json", "JSON body required");
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    for (;;) {
      const item = await reader.read();
      if (item.done) break;
      bytes += item.value.length;
      if (bytes > max) {
        await reader.cancel();
        throw new ProjectHttpError(413, "too_large", "Request is too large");
      }
      chunks.push(item.value);
    }
  } finally {
    reader.releaseLock();
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new ProjectHttpError(400, "invalid_json", "Invalid JSON");
  }
}
export function projectRoute(
  action: (request: Request, caller: Caller) => Promise<unknown>,
  authenticated = false,
) {
  return async (request: Request) => {
    try {
      if (!hasDatabase())
        throw new ProjectHttpError(
          503,
          "unavailable",
          "Publication service is unavailable",
        );
      const caller = await identify(request);
      if (request.headers.has("authorization") && !caller.userId)
        throw new ProjectHttpError(
          401,
          "invalid_token",
          "Credential is invalid, expired or revoked",
        );
      authorizeAgent(request, caller);
      if (authenticated && !caller.userId)
        throw new ProjectHttpError(
          401,
          "sign_in",
          "Sign in to manage your publications",
        );
      const result = await action(request, caller);
      return result instanceof Response
        ? result
        : Response.json(result, { headers: { "Cache-Control": "no-store" } });
    } catch (error) {
      if (error instanceof ProjectValidationError)
        return Response.json(
          { error: "invalid_project", issues: error.issues },
          { status: 422 },
        );
      if (error instanceof ProjectHttpError)
        return Response.json(
          { error: error.code, message: error.message },
          {
            status: error.status,
            headers: {
              "Cache-Control": "no-store",
              ...(error.status === 429 ? { "Retry-After": "60" } : {}),
            },
          },
        );
      return Response.json(
        {
          error: "unavailable",
          message: "Could not complete this request. Your local draft is safe.",
        },
        { status: 503 },
      );
    }
  };
}
export function objectBody(
  value: unknown,
  keys: string[],
): Record<string, unknown> {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => !keys.includes(key))
  )
    throw new ProjectHttpError(
      422,
      "invalid_request",
      "Request contains unsupported fields",
    );
  return value as Record<string, unknown>;
}
