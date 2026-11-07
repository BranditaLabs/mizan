import { createHash } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import { APP_CONFIG, type AppConfig } from "../config.js";
import { SecretValue } from "./secret-value.js";

/**
 * Platform secrets (Mizan's own, not a store's): Key Vault secrets the container receives as
 * secret references (infra/main.tf), read here so no module touches the environment directly and
 * no value prints (SecretValue). Outside production a fixed development value stands in.
 */
@Injectable()
export class PlatformSecrets {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  /** The pepper of the trial keys' HMAC (E12-2a2, docs/16 §7.6): 32 bytes. */
  trialKeyPepper(): SecretValue {
    if (this.config.TRIAL_KEY_PEPPER) return new SecretValue(this.config.TRIAL_KEY_PEPPER);
    if (this.config.NODE_ENV === "production") throw new Error("TRIAL_KEY_PEPPER is required in production");
    return new SecretValue(createHash("sha256").update("mizan-dev-trial-key-pepper").digest("base64"));
  }
}
