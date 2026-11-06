import { describe, expect, it } from "vitest";
import { autoRetryAt } from "../src/integrations/sync-guardian.js";

describe("which dead jobs the guardian brings back by itself", () => {
  it("a job an old worker could not run during a deploy comes back; a refusal waits for a person", () => {
    expect(autoRetryAt('no handler for job kind "shopify.shopProfile"', 0, 1_000)).toBeGreaterThan(1_000);
    expect(autoRetryAt("gave up after 12 attempts — transient: 503", 0, 1_000)).toBeGreaterThan(1_000);
    expect(autoRetryAt("validation: bosta.getDelivery: HTTP 400 Delivery not found.", 0, 1_000)).toBeNull();
    expect(autoRetryAt('no handler for job kind "x"', 3, 1_000)).toBeNull(); // three revivals already
  });
});
