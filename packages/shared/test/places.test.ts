import { describe, expect, it } from "vitest";
import { EG_GOVERNORATES, findRegion, parseLocation, placeKey, regionsOf, searchAreas } from "../src/places.js";

describe("places", () => {
  it("Egypt has its 27 governorates, each with areas, codes unique", () => {
    expect(EG_GOVERNORATES).toHaveLength(27);
    expect(new Set(EG_GOVERNORATES.map((g) => g.code)).size).toBe(27);
    for (const g of EG_GOVERNORATES) expect(g.areas.length).toBeGreaterThan(0);
    expect(regionsOf("sa").length).toBe(13);
    expect(regionsOf("AE").length).toBe(7);
    expect(regionsOf("JO")).toEqual([]);
  });

  it("finds the governorate from a district, in either language and spelling (the Bosta 'sheraton' failure)", () => {
    expect(findRegion("EG", "sheraton")?.en).toBe("Cairo");
    expect(findRegion("EG", "شيراتون")?.en).toBe("Cairo");
    expect(findRegion("EG", "التجمع الخامس")?.en).toBe("Cairo");
    expect(findRegion("EG", "6 October")?.en).toBe("Giza");
    expect(findRegion("EG", "محافظة الإسكندرية")?.en).toBe("Alexandria");
    expect(findRegion("EG", "Fayoum")?.en).toBe("Faiyum");
    expect(findRegion("EG", "nowhere", "Mansoura")?.en).toBe("Dakahlia");
    expect(findRegion("EG", "nowhere")).toBeNull();
    expect(placeKey("  مدينة   نصر ")).toBe("نصر");
  });

  it("suggests areas as you type, word starts first", () => {
    const cairo = findRegion("EG", "Cairo");
    expect(searchAreas(cairo, "nas").map((x) => x.en)).toContain("Nasr City");
    expect(searchAreas(cairo, "مصر").map((x) => x.en)).toEqual(expect.arrayContaining(["Heliopolis", "Old Cairo"]));
    expect(searchAreas(null, "x")).toEqual([]);
  });

  it("reads a location from a Google Maps link or coordinates, Arabic digits too", () => {
    expect(parseLocation("https://www.google.com/maps/place/x/@30.0866,31.3398,17z")).toEqual({ lat: 30.0866, lng: 31.3398 });
    expect(parseLocation("https://maps.google.com/?q=30.0444,31.2357")).toEqual({ lat: 30.0444, lng: 31.2357 });
    expect(parseLocation("https://www.google.com/maps/place/data=!3d29.9792!4d31.1342")).toEqual({ lat: 29.9792, lng: 31.1342 });
    expect(parseLocation("٣٠٫٠٤٤٤، ٣١٫٢٣٥٧")).toEqual({ lat: 30.0444, lng: 31.2357 });
    expect(parseLocation("https://maps.app.goo.gl/abc123")).toBeNull();
    expect(parseLocation("100.1, 20.1")).toBeNull();
  });
});
