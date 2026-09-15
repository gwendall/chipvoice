import { discoveryResponse, protectedResourceMetadata } from "@/lib/oauth";
export const runtime = "nodejs";
/** Root form for clients that probe the host before the path-inserted RFC 9728 URL. */
export function GET() {
  return discoveryResponse(protectedResourceMetadata());
}
