import Connect from "@/community/Connect";
import { pageMetadata } from "@/i18n/metadata";
export const generateMetadata = pageMetadata("connect");
export default function Page() {
  return <Connect />;
}
