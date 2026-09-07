import Creator from "@/create/Creator";
import { pageMetadata } from "@/i18n/metadata";
export const generateMetadata = pageMetadata("create");
export default function Page() {
  return <Creator />;
}
