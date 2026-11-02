import { IntegrationError } from "../../src/core/errors.js";
import { unreachableNumber, type MessagingChannel, type MessagingProvider, type Sms, type VoiceCall, type WhatsAppTemplate } from "../../src/connectors/messaging/provider.js";

export type FakeSent =
  | { channel: "whatsapp"; ref: string; message: WhatsAppTemplate }
  | { channel: "sms"; ref: string; message: Sms }
  | { channel: "voice"; ref: string; message: VoiceCall };

/**
 * A messaging vendor for tests: records every send; can be told which channels it has, to fail
 * the next sends (transient), time out, or refuse a number (permanent), like real vendors do.
 */
export class FakeMessaging implements MessagingProvider {
  readonly name = "fake";
  channels: ReadonlySet<MessagingChannel>;
  readonly sent: FakeSent[] = [];
  /** Next N sends fail with a retryable error. */
  failNext = 0;
  /** Next N sends time out (outcome unknown; vendors take an idempotency key, so retrying is safe). */
  timeoutNext = 0;
  readonly refused = new Set<string>();
  private n = 0;

  constructor(channels: MessagingChannel[] = ["whatsapp", "sms", "voice"]) {
    this.channels = new Set(channels);
  }

  private deliver<C extends MessagingChannel>(channel: C, to: string, message: unknown): Promise<{ ref: string }> {
    if (!this.channels.has(channel)) return Promise.reject(new IntegrationError({ kind: "validation", connector: this.name, message: `${channel} not connected` }));
    if (this.refused.has(to)) return Promise.reject(unreachableNumber(this.name, to));
    if (this.failNext > 0) { this.failNext--; return Promise.reject(new IntegrationError({ kind: "transient", connector: this.name, message: "vendor 503" })); }
    if (this.timeoutNext > 0) { this.timeoutNext--; return Promise.reject(new IntegrationError({ kind: "timeout", connector: this.name, message: "vendor timed out" })); }
    const ref = `fake-${channel}-${++this.n}`;
    this.sent.push({ channel, ref, message } as FakeSent);
    return Promise.resolve({ ref });
  }

  sendWhatsApp(m: WhatsAppTemplate) { return this.deliver("whatsapp", m.to, m); }
  sendSms(m: Sms) { return this.deliver("sms", m.to, m); }
  placeCall(c: VoiceCall) { return this.deliver("voice", c.to, c); }
  of(channel: MessagingChannel) { return this.sent.filter((s) => s.channel === channel); }
}
