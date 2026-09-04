import type { Metadata } from "next";
import Studio from "@/studio/App";

export const metadata: Metadata = {
  title: "chipvoice - write music on the sound chips of the old machines",
  description:
    "Four lines of text, four channels, the NES's 2A03, the Game Boy's APU or the Mega Drive's FM chip emulated to the cycle. Sound effects steal channels from the music, the way the hardware did.",
  openGraph: {
    title: "chipvoice",
    description:
      "Write music on a real NES, Game Boy or Mega Drive sound chip in a browser tab. Songs are text, and they fork like code.",
    url: "https://chipvoice.dev",
    type: "website",
  },
};

/**
 * The editor and the API are one deployment.
 *
 * They were two for an afternoon, and the URLs made the case against it: a
 * shared link is `/s/{id}`, and it has to sit on the same host as the editor
 * somebody lands in when they press fork. Two projects meant either a shared
 * link on an api. subdomain or a proxy between them, and neither is worth it
 * for what is one Next app.
 */
export default function Page() {
  return <Studio />;
}
