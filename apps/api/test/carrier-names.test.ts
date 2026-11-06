import { describe, expect, it } from "vitest";
import { shopifyCarrier } from "../src/integrations/store-writeback.consumer.js";

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
