import { setRequestLocale } from "next-intl/server";
import { SignIn } from "@/components/auth/SignIn";
import { StaffFrame } from "@/components/auth/StaffFrame";

export default async function SignInPage({ params }: { params: Promise<{ locale: string }> }) {
  setRequestLocale((await params).locale);
  return <StaffFrame><SignIn /></StaffFrame>;
}
