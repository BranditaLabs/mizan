/** Fake providers and a virtual clock for tests outside this package (`@mizan/engine/testing`). */
export { FakeBosta } from "./bosta.js";
export { FakeClock, hang, json, seeded, testRuntime, type Route } from "./clock.js";
export { FakeShopify } from "./shopify.js";
export { FakeMessaging, type FakeSent } from "./messaging.js";
export { FakeWhatsApp, type FakeWaMessage } from "./whatsapp.js";
