import { SignInConfirm } from "@/auth/SignInConfirm";
import { pageMetadata } from "@/i18n/metadata";
export const generateMetadata = pageMetadata("signinConfirm");
export default function Page() { return <SignInConfirm/>; }
