import Explore from "@/community/Explore";
import { pageMetadata } from "@/i18n/metadata";
export const generateMetadata = pageMetadata("library");
export default function Page() {
  return <Explore mine />;
}
