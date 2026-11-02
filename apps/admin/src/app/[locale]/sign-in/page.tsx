import { setRequestLocale } from "next-intl/server";
import { SignIn } from "@/components/auth/SignIn";
import { Wordmark } from "@/components/Wordmark";

export default async function SignInPage({ params }: { params: Promise<{ locale: string }> }) {
  setRequestLocale((await params).locale);
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center gap-6 px-4 py-10">
      <Wordmark />
      <SignIn />
    </main>
  );
}
