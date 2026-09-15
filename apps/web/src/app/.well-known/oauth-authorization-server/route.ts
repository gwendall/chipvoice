import { authorizationServerMetadata, discoveryResponse } from "@/lib/oauth";
export const runtime = "nodejs";
/** RFC 8414: how an agent finds the device grant without reading a guide. */
export function GET() {
  return discoveryResponse(authorizationServerMetadata());
}
