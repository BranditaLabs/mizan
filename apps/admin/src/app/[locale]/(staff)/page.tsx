import { redirect } from "@/i18n/navigation";

export default async function Home({ params }: { params: Promise<{ locale: string }> }) {
  redirect({ href: "/stores", locale: (await params).locale });
}
