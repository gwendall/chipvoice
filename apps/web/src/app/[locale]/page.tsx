import {pageMetadata} from '@/i18n/metadata';
import Playground from "@/arrangements/Playground";
import catalogue from "../../../generated/arrangement-catalogue.json";
import overview from "../../../public/arrangement-data/mario-view.json";
import type {Report} from "@/arrangements/Arrangements";

export const generateMetadata = pageMetadata('home');

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
