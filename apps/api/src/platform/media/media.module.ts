import { Global, Module } from "@nestjs/common";
import { APP_CONFIG, type AppConfig } from "../config.js";
import { BlobStore } from "./blob-store.js";
import { MediaController } from "./media.controller.js";
import { BLOB_STORE, MediaService } from "./media.service.js";

/** Pictures uploaded to Mizan (P3): Blob Storage when MEDIA_BLOB_URL is set, else the database. */
@Global()
@Module({
  controllers: [MediaController],
  providers: [
    MediaService,
    {
      provide: BLOB_STORE,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => {
        if (!config.MEDIA_BLOB_URL) return null;
        const env = process.env;
        // Azure Container Apps sets IDENTITY_ENDPOINT and IDENTITY_HEADER; AZURE_CLIENT_ID picks the user-assigned identity.
        const identity = env.IDENTITY_ENDPOINT && env.IDENTITY_HEADER ? { endpoint: env.IDENTITY_ENDPOINT, header: env.IDENTITY_HEADER, clientId: config.AZURE_CLIENT_ID } : null;
        return new BlobStore(config.MEDIA_BLOB_URL, identity);
      },
    },
  ],
  exports: [MediaService],
})
export class MediaModule {}
