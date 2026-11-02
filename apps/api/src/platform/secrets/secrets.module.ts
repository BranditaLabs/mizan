import { Global, Logger, Module, type DynamicModule } from "@nestjs/common";
import { APP_CONFIG, type AppConfig } from "../config.js";
import { KEY_WRAPPER, LocalKeyWrapper, type KeyWrapper } from "./key-wrapper.js";
import { KeyVaultKeyWrapper } from "./keyvault-wrapper.js";
import { SecretsService } from "./secrets.service.js";
import { PiiCipher } from "../pii/pii-cipher.js";

/** KEY_VAULT_KEY_ID → Azure Key Vault; else SECRETS_DEV_KEY → local key; else (non-production) an ephemeral key. */
export function keyWrapperFor(config: AppConfig, logger = new Logger("Secrets"), env: NodeJS.ProcessEnv = process.env): KeyWrapper {
  if (config.KEY_VAULT_KEY_ID) {
    // Azure Container Apps sets IDENTITY_ENDPOINT and IDENTITY_HEADER; AZURE_CLIENT_ID picks the user-assigned identity.
    const identity = env.IDENTITY_ENDPOINT && env.IDENTITY_HEADER ? { endpoint: env.IDENTITY_ENDPOINT, header: env.IDENTITY_HEADER, clientId: config.AZURE_CLIENT_ID } : null;
    return new KeyVaultKeyWrapper(config.KEY_VAULT_KEY_ID, identity);
  }
  if (config.SECRETS_DEV_KEY) return new LocalKeyWrapper(Buffer.from(config.SECRETS_DEV_KEY, "base64"));
  logger.warn("no KEY_VAULT_KEY_ID or SECRETS_DEV_KEY: secrets use an ephemeral key and will not decrypt after a restart");
  return LocalKeyWrapper.ephemeral();
}

@Global()
@Module({})
export class SecretsModule {
  /** `wrapper` overrides the key wrapper (tests). */
  static forRoot(wrapper?: KeyWrapper): DynamicModule {
    return {
      module: SecretsModule,
      providers: [
        SecretsService,
        PiiCipher,
        wrapper ? { provide: KEY_WRAPPER, useValue: wrapper } : { provide: KEY_WRAPPER, inject: [APP_CONFIG], useFactory: (c: AppConfig) => keyWrapperFor(c) },
      ],
      exports: [SecretsService, PiiCipher],
    };
  }
}
