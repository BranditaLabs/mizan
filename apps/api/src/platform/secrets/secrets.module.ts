import { Global, Logger, Module, type DynamicModule } from "@nestjs/common";
import { APP_CONFIG, type AppConfig } from "../config.js";
import { CloudKmsKeyWrapper } from "./kms-wrapper.js";
import { KEY_WRAPPER, LocalKeyWrapper, type KeyWrapper } from "./key-wrapper.js";
import { SecretsService } from "./secrets.service.js";
import { PiiCipher } from "../pii/pii-cipher.js";

/** KMS_KEY_NAME → Cloud KMS; else SECRETS_DEV_KEY → local key; else (non-production) an ephemeral key. */
export function keyWrapperFor(config: AppConfig, logger = new Logger("Secrets")): KeyWrapper {
  if (config.KMS_KEY_NAME) return new CloudKmsKeyWrapper(config.KMS_KEY_NAME);
  if (config.SECRETS_DEV_KEY) return new LocalKeyWrapper(Buffer.from(config.SECRETS_DEV_KEY, "base64"));
  logger.warn("no KMS_KEY_NAME or SECRETS_DEV_KEY: secrets use an ephemeral key and will not decrypt after a restart");
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
