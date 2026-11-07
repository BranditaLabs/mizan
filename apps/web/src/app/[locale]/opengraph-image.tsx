import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";

/** The Open Graph card (Brand 2.0): the two-ball mark and the wordmark in the page's script, on paper. */
export const alt = "Mizan · ميزان";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const svg = async (name: string) => `data:image/svg+xml;base64,${(await readFile(join(process.cwd(), "public/brand", name))).toString("base64")}`;

export default async function OpengraphImage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const ar = locale === "ar";
  const [mark, word] = await Promise.all([svg("mizan-mark.svg"), svg(ar ? "mizan-wordmark-ar.svg" : "mizan-wordmark.svg")]);
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: 56, background: "#FEF7FF", flexDirection: ar ? "row-reverse" : "row" }}>
        <img src={mark} alt="" width={260} height={151} />
        <img src={word} alt="" width={ar ? 380 : 520} height={ar ? 169 : 143} />
      </div>
    ),
    size,
  );
}
