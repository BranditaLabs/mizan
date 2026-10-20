import { redirect } from "@/i18n/navigation";

/**
 * The link in an invitation email (apps/api members.service acceptUrl). Pending invitations for
 * the signed-in person are listed on the welcome page, after sign-in if needed.
 */
export default async function InvitationPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  redirect({ href: "/welcome", locale });
}
