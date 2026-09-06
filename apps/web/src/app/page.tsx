import type { Metadata } from "next";
import Playground from "@/arrangements/Playground";
import catalogue from "../../generated/arrangement-catalogue.json";
import overview from "../../public/arrangement-data/mario-view.json";
import type {Report} from "@/arrangements/Arrangements";

export const metadata: Metadata = {
  title: "chipvoice · Old consoles. New JavaScript.",
  description: "An open-source sound-chip emulator in JavaScript. Play complete Mario, Zelda and Sonic arrangements on Famicom, Game Boy, Mega Drive and Super Famicom, then make your own music.",
  openGraph: {
    title: "chipvoice · Old consoles. New JavaScript.",
    description: "Hear complete arrangements through emulated sound chips. Synthesized with our JavaScript engines. Switch consoles, play with the sound, take the code.",
    url: "https://chipvoice.dev", type: "website",
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
  return <Playground catalogue={catalogue as Report} initialOverview={overview}/>;
}
