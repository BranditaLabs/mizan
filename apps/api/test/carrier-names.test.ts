import { describe, expect, it } from "vitest";
import { shopifyCarrier } from "../src/integrations/store-writeback.consumer.js";
import { trackingTemplate } from "../src/modules/shipping/shipping.service.js";

describe("carrier names for Shopify", () => {
  it("the names Shopify links by itself, however the team typed them; others as typed", () => {
    expect(shopifyCarrier("aramex")).toBe("Aramex");
    expect(shopifyCarrier("أرامكس")).toBe("Aramex");
    expect(shopifyCarrier(" DHL ")).toBe("DHL Express");
    expect(shopifyCarrier("j&t")).toBe("J&T Express");
    expect(shopifyCarrier("smsa")).toBe("SMSA Express");
    expect(shopifyCarrier("Our  driver")).toBe("Our driver");
  });
});

describe("a courier's tracking page learned from one link", () => {
  it("only when the number stands whole in the path or a query value, every time it appears", () => {
    expect(trackingTemplate("https://x.example/track/ABC123?awb=ABC123", "ABC123")).toBe("https://x.example/track/{tn}?awb={tn}");
    expect(trackingTemplate("https://x.example/t?n=AX-501", "AX-501")).toBe("https://x.example/t?n={tn}");
  });
  it("never from a number inside another word or the host, nor from a non-https link", () => {
    expect(trackingTemplate("https://x.example/track/XABC123", "ABC123")).toBeNull();
    expect(trackingTemplate("https://abc123.example/track/ABC123", "ABC123")).toBeNull();
    expect(trackingTemplate("https://x.example/track", "ABC123")).toBeNull();
    expect(trackingTemplate("http://x.example/track/ABC123", "ABC123")).toBeNull();
  });
});
