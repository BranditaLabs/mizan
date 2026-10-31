import { StoreDetail } from "@/components/stores/StoreDetail";

export default async function StorePage({ params }: { params: Promise<{ storeId: string }> }) {
  return <StoreDetail storeId={(await params).storeId} />;
}
