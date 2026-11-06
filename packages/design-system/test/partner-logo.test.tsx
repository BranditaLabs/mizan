import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { PartnerLogo } from "../logos/partners/react";

describe("<PartnerLogo>", () => {
  it("labels the mark with the brand's name, or hides it when the name is written next to it", () => {
    const html = renderToStaticMarkup(<PartnerLogo slug="woocommerce" size={48} locale="ar" />);
    expect(html).toContain('role="img"');
    expect(html).toContain('aria-label="ووكومرس"');
    expect(html).toContain('fill="#873EFF"');
    expect(html).toContain("mz-partner-tile");
    const hidden = renderToStaticMarkup(<PartnerLogo slug="woocommerce" size={48} decorative />);
    expect(hidden).toContain('aria-hidden="true"');
    expect(hidden).not.toContain("role=");
  });

  it("mono renders the light and the dark file for the theme switch", () => {
    const html = renderToStaticMarkup(<PartnerLogo slug="x" size={32} variant="mono" />);
    expect(html).toContain('data-scheme="light"');
    expect(html).toContain('data-scheme="dark"');
    expect(html).toContain('fill="#000000"');
    expect(html).toContain('fill="#FFFFFF"');
  });

  it("a brand without a usable mark is a monogram tile, never a guessed glyph", () => {
    const html = renderToStaticMarkup(<PartnerLogo slug="bosta" size={32} />);
    expect(html).toContain("mz-partner-monogram");
    expect(html).toContain('aria-label="Bosta"');
    expect(html).not.toContain("<svg");
  });
});
