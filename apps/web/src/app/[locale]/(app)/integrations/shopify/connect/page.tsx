import { setRequestLocale } from "next-intl/server";
import { ShopifyConnect } from "@/components/onboarding/ShopifyConnect";

type Props = { params: Promise<{ locale: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? null;

/** Where the API's Shopify callback sends the browser (E3-1): `?install=&shop=` or `?error=`. */
export default async function ShopifyConnectPage({ params, searchParams }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  const q = await searchParams;
  return <ShopifyConnect install={one(q.install)} error={one(q.error)} />;
}
