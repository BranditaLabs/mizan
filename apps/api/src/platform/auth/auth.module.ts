import { Global, Module, type DynamicModule } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { APP_CONFIG, type AppConfig } from "../config.js";
import { AuthGuard } from "./auth.guard.js";
import { AuthService } from "./auth.service.js";
import { RateLimiter } from "../http/rate-limit.js";
import { DisabledTokenVerifier, FirebaseTokenVerifier, TOKEN_VERIFIER, type TokenVerifier } from "./token-verifier.js";

@Global()
@Module({})
export class AuthModule {
  /** `verifier` overrides the Firebase verifier (tests). */
  static forRoot(verifier?: TokenVerifier): DynamicModule {
    return {
      module: AuthModule,
      providers: [
        AuthService,
        RateLimiter,
        verifier
          ? { provide: TOKEN_VERIFIER, useValue: verifier }
          : {
              provide: TOKEN_VERIFIER,
              inject: [APP_CONFIG],
              useFactory: (config: AppConfig) =>
                config.FIREBASE_PROJECT_ID ? new FirebaseTokenVerifier(config.FIREBASE_PROJECT_ID) : new DisabledTokenVerifier(),
            },
        { provide: APP_GUARD, useClass: AuthGuard },
      ],
      exports: [AuthService, TOKEN_VERIFIER],
    };
  }
}
