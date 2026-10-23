import { IntegrationError } from "../../core/errors.js";
import type { Logger } from "../../core/runtime.js";

/**
 * Customer messaging for order confirmation (M2, E6-7): WhatsApp, SMS and automated voice.
 * One interface for every vendor, so a store can use Meta for WhatsApp and a local operator for
 * SMS and calls, and a new vendor plugs in without touching the confirmation flow. Real
 * connectors (WhatsApp Cloud E6-4, SMS + IVR E6-8, AI voice E6-9) go through `send()` and get a
 * fake server and the chaos suite like every connector (CLAUDE.md rules 4 and 15).
 *
 * Errors are `IntegrationError`s: `validation` for a number the vendor refuses (not retried),
 * `transient`/`timeout`/`rate_limited` to retry.
 */
export type MessagingChannel = "whatsapp" | "sms" | "voice";

export interface WhatsAppTemplate {
  /** E.164 */
  to: string;
  /** Approved template name (Meta), e.g. "order_confirmation". */
  template: string;
  lang: "ar" | "en";
  /** Body parameters in order. */
  params: string[];
  /** Quick-reply payloads, in button order: confirm, change, cancel. */
  buttons: string[];
  /** The confirm link, for a URL button. */
  url: string;
}

export interface Sms {
  to: string;
  text: string;
}

/** An automated call (IVR): prompts are read in order; the customer presses a digit. */
export interface VoiceCall {
  to: string;
  lang: "ar" | "en";
  prompts: string[];
  /** Digit → answer, e.g. { "1": "confirm", "2": "change", "3": "cancel" }. */
  digits: Record<string, string>;
  /** Where the vendor posts the pressed digit (E6-8). */
  callbackUrl: string;
}

export interface MessagingProvider {
  readonly name: string;
  /** Channels this provider can deliver for the store. */
  readonly channels: ReadonlySet<MessagingChannel>;
  sendWhatsApp(m: WhatsAppTemplate): Promise<{ ref: string }>;
  sendSms(m: Sms): Promise<{ ref: string }>;
  placeCall(c: VoiceCall): Promise<{ ref: string }>;
}

/** "+201001234821" → "+20•••••4821": numbers in logs never in full. */
export const maskNumber = (e164: string) => (e164.length > 6 ? `${e164.slice(0, 3)}${"•".repeat(Math.max(0, e164.length - 7))}${e164.slice(-4)}` : "•••");

/**
 * Development only: pretends every channel is connected and logs what would be sent, with the
 * number masked and no message text (personal data stays out of logs).
 */
export class LogMessaging implements MessagingProvider {
  readonly name = "log";
  readonly channels: ReadonlySet<MessagingChannel> = new Set(["whatsapp", "sms", "voice"]);
  private n = 0;
  constructor(private readonly logger: Logger) {}
  private record(channel: MessagingChannel, to: string) {
    const ref = `log-${channel}-${++this.n}`;
    this.logger.log("info", "messaging.send", { channel, to: maskNumber(to), ref });
    return Promise.resolve({ ref });
  }
  sendWhatsApp(m: WhatsAppTemplate) { return this.record("whatsapp", m.to); }
  sendSms(m: Sms) { return this.record("sms", m.to); }
  placeCall(c: VoiceCall) { return this.record("voice", c.to); }
}

/** The error a provider throws for a number it will never reach (wrong, landline, blocked). */
export const unreachableNumber = (provider: string, e164: string) =>
  new IntegrationError({ kind: "validation", connector: provider, message: `number ${maskNumber(e164)} cannot receive this channel` });
