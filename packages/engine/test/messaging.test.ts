import { describe, expect, it } from "vitest";
import { LogMessaging, maskNumber } from "../src/connectors/messaging/provider.js";
import { FakeMessaging } from "./fakes/messaging.js";

describe("messaging providers (E6-7)", () => {
  it("masks numbers for logs", () => {
    expect(maskNumber("+201001234821")).toBe("+20••••••4821");
    expect(maskNumber("123")).toBe("•••");
  });

  it("log provider records masked numbers and no message text", async () => {
    const lines: Array<Record<string, unknown>> = [];
    const p = new LogMessaging({ log: (_l, msg, data) => lines.push({ msg, ...data }) });
    expect(await p.sendSms({ to: "+201001234821", text: "أكّد أوردرك من هنا" })).toEqual({ ref: "log-sms-1" });
    expect(JSON.stringify(lines)).not.toMatch(/1001234821|أكّد/);
    expect(lines[0]).toMatchObject({ msg: "messaging.send", channel: "sms", to: "+20••••••4821" });
  });

  it("fake provider behaves like a vendor: missing channel, refused number, transient failure, timeout", async () => {
    const f = new FakeMessaging(["sms"]);
    await expect(f.sendWhatsApp({ to: "+201", template: "t", lang: "ar", params: [], buttons: [], url: "" })).rejects.toMatchObject({ kind: "validation" });
    f.refused.add("+201000000000");
    await expect(f.sendSms({ to: "+201000000000", text: "x" })).rejects.toMatchObject({ kind: "validation", retryable: false });
    f.failNext = 1;
    await expect(f.sendSms({ to: "+201001234821", text: "x" })).rejects.toMatchObject({ kind: "transient", retryable: true });
    f.timeoutNext = 1;
    await expect(f.sendSms({ to: "+201001234821", text: "x" })).rejects.toMatchObject({ kind: "timeout" });
    expect(await f.sendSms({ to: "+201001234821", text: "x" })).toEqual({ ref: "fake-sms-1" });
    expect(f.of("sms")).toHaveLength(1);
  });
});
