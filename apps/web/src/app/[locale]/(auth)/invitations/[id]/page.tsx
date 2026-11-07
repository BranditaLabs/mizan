import { redirect } from "@/i18n/navigation";
import { parseInvite } from "@/lib/auth/params";

/**
 * The link in an invitation email (apps/api members.service acceptUrl): to the welcome page with
 * the invitation in focus, after sign-in if needed. The id must be a uuid; anything else becomes
 * the "unknown" sentinel, so nothing from the URL is echoed and no store is named before sign-in.
 */
export default async function InvitationPage({ params }: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await params;
  redirect({ href: `/welcome?invite=${parseInvite(id) ?? "unknown"}`, locale });
}
