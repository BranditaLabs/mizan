import { Inject, Injectable } from "@nestjs/common";
import { defaultRuntime, LogMessaging, type MessagingChannel, type MessagingProvider } from "@mizan/engine";
import { APP_CONFIG, type AppConfig } from "../../platform/config.js";

/**
 * Which messaging vendor a store can use for each channel (E6-7). Until a vendor is connected
 * (WhatsApp E6-4, SMS + voice E6-8) there is none: the cascade skips automated channels and
 * hands the order to an agent, who sends the confirm link by hand. Tests install a fake.
 */
@Injectable()
export class MessagingRegistry {
  private override: MessagingProvider | null | undefined;
  private readonly configured: MessagingProvider | null;

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    this.configured = config.MESSAGING_PROVIDER === "log" ? new LogMessaging(defaultRuntime().logger) : null;
  }

  /** Tests: use this provider for every store (null = none connected); undefined restores config. */
  use(provider: MessagingProvider | null | undefined): void {
    this.override = provider;
  }

  providerFor(_tenantId: string): MessagingProvider | null {
    return this.override !== undefined ? this.override : this.configured;
  }

  channelsFor(tenantId: string): Record<MessagingChannel, boolean> {
    const p = this.providerFor(tenantId);
    return { whatsapp: Boolean(p?.channels.has("whatsapp")), sms: Boolean(p?.channels.has("sms")), voice: Boolean(p?.channels.has("voice")) };
  }
}
