import SignIn from "@/auth/SignIn";
import { pageMetadata } from "@/i18n/metadata";
export const generateMetadata = pageMetadata("signin");
export default function Page() { return <SignIn/>; }
