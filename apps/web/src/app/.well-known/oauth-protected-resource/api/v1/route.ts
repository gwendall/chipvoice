import { discoveryResponse, protectedResourceMetadata } from "@/lib/oauth";
export const runtime = "nodejs";
/** RFC 9728 section 3.1: the metadata URL for the /api/v1 resource. */
export function GET() {
  return discoveryResponse(protectedResourceMetadata());
}
