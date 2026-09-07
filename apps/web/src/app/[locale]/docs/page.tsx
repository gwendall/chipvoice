import Docs from "@/create/Docs";
import { pageMetadata } from "@/i18n/metadata";
export const generateMetadata = pageMetadata("docs");
export default function Page() {
  return <Docs />;
}
