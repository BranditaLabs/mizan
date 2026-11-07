import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PartnerLogo } from "../logos/partners/react";

const css = readFileSync(join(__dirname, "../css/components.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const tokens = readFileSync(join(__dirname, "../dist/tokens.css"), "utf8").replace(/\r\n/g, "\n");
/** The custom properties a theme scope in tokens.css sets for the partner faces. */
const faces = (scope: string) => {
  const at = tokens.indexOf(`${scope} {`);
  const body = at < 0 ? "" : tokens.slice(at, tokens.indexOf("}", at));
  return [...body.matchAll(/(--mz-partner-face-(?:light|dark)):\s*([a-z-]+);/g)].map((m) => `${m[1]}: ${m[2]}`);
};
/** The declarations of the first rule whose selector list is exactly `selector`. */
const rule = (selector: string) => {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s*");
  return new RegExp(`(?:^|[}\\s])${esc}\\s*\\{([^}]*)\\}`).exec(css)?.[1]?.trim();
};

describe("<PartnerLogo>", () => {
  it("labels the mark with the brand's name, or hides it when the name is written next to it", () => {
    const html = renderToStaticMarkup(<PartnerLogo slug="woocommerce" size={48} variant="mono" locale="ar" />);
    expect(html).toContain('role="img"');
    expect(html).toContain('aria-label="ووكومرس"');
    expect(html).toContain('fill="#000000"');
    const hidden = renderToStaticMarkup(<PartnerLogo slug="woocommerce" size={48} variant="mono" decorative />);
    expect(hidden).toContain('aria-hidden="true"');
    expect(hidden).not.toContain("role=");
  });

  it("the owner's bitmap renders as <img> with 1x/2x/3x, its size, alt in the reader's language and async decoding (DS-3b)", () => {
    const html = renderToStaticMarkup(<PartnerLogo slug="bosta" size={40} locale="ar" />);
    expect(html).toContain('src="/partners/bosta-mark@1x.png"');
    expect(html).toMatch(/srcSet="\/partners\/bosta-mark@1x.png 32w, \/partners\/bosta-mark@2x.png 64w, \/partners\/bosta-mark@3x.png 96w"/i);
    expect(html).toMatch(/width="\d+" height="\d+"/);
    expect(html).toContain('alt="بوسطة"');
    expect(html).toContain('decoding="async"');
    expect(html).toContain("mz-partner-tile");
    expect(html).not.toContain("<link"); // lazy: no preload hoisted for every logo on a page
    // Decorative: an empty alt, hidden from screen readers.
    const hidden = renderToStaticMarkup(<PartnerLogo slug="bosta" size={40} decorative />);
    expect(hidden).toContain('alt=""');
    expect(hidden).toContain('aria-hidden="true"');
    // assetBase moves the files.
    expect(renderToStaticMarkup(<PartnerLogo slug="bosta" size={40} assetBase="/cdn/p" />)).toContain('src="/cdn/p/bosta-mark@1x.png"');
  });

  it("a lockup with black parts has a light and a dark face; marks sit on their tile", () => {
    const html = renderToStaticMarkup(<PartnerLogo slug="shopify" size={24} shape="lockup" />);
    expect(html).toContain('data-shape="lockup"');
    expect(html).toContain('data-scheme="light"');
    expect(html).toContain('data-scheme="dark"');
    expect(html).toContain("/partners/shopify-lockup-dark@1x.png");
    expect(html).not.toContain("mz-partner-tile");
    const mark = renderToStaticMarkup(<PartnerLogo slug="shopify" size={40} />);
    expect(mark).not.toContain("data-scheme");
    expect(mark).toContain("mz-partner-tile");
  });

  it("mono renders the light and the dark file for the theme switch", () => {
    const html = renderToStaticMarkup(<PartnerLogo slug="woocommerce" size={32} variant="mono" />);
    expect(html).toContain('data-scheme="light"');
    expect(html).toContain('data-scheme="dark"');
    expect(html).toContain('fill="#000000"');
    expect(html).toContain('fill="#FFFFFF"');
  });

  it("mono adds the colour mark on its tile for hover and focus (D8), colour does not", () => {
    const mono = renderToStaticMarkup(<PartnerLogo slug="woocommerce" size={32} variant="mono" />);
    expect(mono).toContain('data-scheme="hover"');
    expect(mono).toContain('data-hover=""');
    expect(mono).toContain("/partners/woocommerce-mark@1x.png");
    const colour = renderToStaticMarkup(<PartnerLogo slug="woocommerce" size={32} />);
    expect(colour).not.toContain('data-scheme="hover"');
    expect(colour).not.toContain("data-hover");
  });

  it("an id the manifest does not know is named by the caller's label, not its raw id", () => {
    const html = renderToStaticMarkup(<PartnerLogo slug="new_courier_x" size={32} locale="ar" label="شركة جديدة" />);
    expect(html).toContain('aria-label="شركة جديدة"');
    expect(html).not.toContain('aria-label="new_courier_x"');
    // Manifest entries keep their own names whatever the label says.
    expect(renderToStaticMarkup(<PartnerLogo slug="manual" size={32} locale="ar" label="x" />)).toContain('aria-label="يدوي"');
  });

  it("a brand without a usable mark is a monogram tile, never a guessed glyph", () => {
    const html = renderToStaticMarkup(<PartnerLogo slug="mylerz" size={32} />);
    expect(html).toContain("mz-partner-monogram");
    expect(html).toContain('aria-label="Mylerz"');
    expect(html).not.toContain("<svg");
  });
});

/**
 * The face switch must follow the nearest data-theme, as the tokens do (a light pick list, label or
 * dispute page inside a dark app): it is a custom property set on every theme scope, never a
 * descendant-of-dark selector, which would show the white file on a light island.
 */
describe("partner face CSS", () => {
  it("faces read a per-scope custom property, so a light island inside a dark root shows the light file", () => {
    expect(rule('.mz-partner [data-scheme="light"]')).toBe("display: var(--mz-partner-face-light, inline-flex);");
    expect(rule('.mz-partner [data-scheme="dark"]')).toBe("display: var(--mz-partner-face-dark, none);");
    // Every scope that redefines the tokens also sets the faces: the island's own value wins by inheritance.
    const light = ["--mz-partner-face-light: inline-flex", "--mz-partner-face-dark: none"];
    const dark = ["--mz-partner-face-light: none", "--mz-partner-face-dark: inline-flex"];
    expect(faces(':root, [data-theme="light"]')).toEqual(light);
    expect(faces('[data-theme="dark"]')).toEqual(dark);
    expect(faces(':root:not([data-theme="light"])')).toEqual(dark); // the system's dark, unless light was chosen
    // No rule picks a face by a dark ancestor anywhere up the tree.
    expect(css).not.toMatch(/\[data-theme="dark"\][^{}]*\.mz-partner[^{}]*\{/);
    expect(css).not.toMatch(/:root:not\(\[data-theme="light"\]\)[^{}]*\.mz-partner[^{}]*\{/);
  });

  it("the hover face swaps in only on hover and focus, and never under reduced motion", () => {
    expect(rule('.mz-partner [data-scheme="hover"]')).toBe("display: none;");
    const block = /@media \(prefers-reduced-motion: no-preference\)\s*\{([\s\S]*?\})\s*\}/.exec(css)?.[1] ?? "";
    expect(block).toContain('.mz-partner:is(:hover, :focus-within) > [data-scheme="hover"]');
    expect(block).toContain('.mz-partner[data-hover]:is(:hover, :focus-within) > .mz-partner-face:not([data-scheme="hover"])');
    expect(block).not.toMatch(/transition|animation|transform/);
    const outside = css.replace(block, "");
    expect(outside).not.toMatch(/:hover[^{}]*data-scheme="hover"/);
  });
});
