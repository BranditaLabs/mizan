import type { ReactNode } from "react";
import { SettingsLayout } from "@/components/settings/SettingsLayout";

/** Every settings page sits in the grouped settings frame (U4). */
export default function Layout({ children }: { children: ReactNode }) {
  return <SettingsLayout>{children}</SettingsLayout>;
}
