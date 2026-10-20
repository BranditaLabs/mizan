import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { Global, Module, type DynamicModule } from "@nestjs/common";
import { LoggerModule as PinoLoggerModule } from "nestjs-pino";
import type { DestinationStream, LoggerOptions } from "pino";
import { APP_CONFIG, type AppConfig } from "../config.js";
import { PINO_REDACT_PATHS, REDACTED, redactDeep, scrubText, scrubUrl } from "./redact.js";

const REQUEST_ID = /^[A-Za-z0-9_-]{1,64}$/;

export function requestIdFor(req: IncomingMessage, res: ServerResponse): string {
  const incoming = req.headers["x-request-id"];
  const id = typeof incoming === "string" && REQUEST_ID.test(incoming) ? incoming : `req_${randomUUID().replaceAll("-", "")}`;
  res.setHeader("X-Request-Id", id);
  return id;
}

/** pino options shared by the HTTP logger and the worker. Redaction is on in every environment. */
export function pinoOptions(config: AppConfig): LoggerOptions {
  return {
    level: config.LOG_LEVEL,
    base: { service: "mizan-api" },
    messageKey: "message",
    redact: { paths: PINO_REDACT_PATHS, censor: REDACTED },
    formatters: {
      // Cloud Logging reads `severity`.
      level: (label) => ({ severity: label.toUpperCase(), level: label }),
      // Scrub every string in the merged log object (phones, emails, tokens in free text).
      log: (obj) => redactDeep(obj) as Record<string, unknown>,
    },
    hooks: {
      logMethod(args, method) {
        const scrubbed = args.map((a) => (typeof a === "string" ? scrubText(a) : a)) as Parameters<typeof method>;
        method.apply(this, scrubbed);
      },
    },
    serializers: {
      err: (err: unknown) => redactDeep(err),
    },
    ...(config.NODE_ENV === "development"
      ? { transport: { target: "pino-pretty", options: { singleLine: true, messageKey: "message" } } }
      : {}),
  };
}

@Global()
@Module({})
export class LoggingModule {
  /** `destination` overrides stdout (tests capture log lines through it). */
  static forRoot(destination?: DestinationStream): DynamicModule {
    return {
      module: LoggingModule,
      imports: [
        PinoLoggerModule.forRootAsync({
          inject: [APP_CONFIG],
          useFactory: (config: AppConfig) => {
            const options = {
              ...pinoOptions(config),
              ...(destination ? { transport: undefined } : {}),
              genReqId: requestIdFor,
              customLogLevel: (_req: IncomingMessage, res: ServerResponse, err?: Error) =>
                err || res.statusCode >= 500 ? "error" : res.statusCode >= 400 ? "warn" : "info",
              serializers: {
                err: (err: unknown) => redactDeep(err),
                // Only what operators need; the query string may carry personal data, so it is scrubbed.
                req: (req: { id?: string; method?: string; url?: string }) => ({
                  id: req.id,
                  method: req.method,
                  url: req.url ? scrubUrl(req.url) : undefined,
                }),
                res: (res: { statusCode?: number | null; raw?: ServerResponse }) => ({ statusCode: res.raw?.statusCode ?? res.statusCode }),
              },
              autoLogging: { ignore: (req: IncomingMessage) => req.url === "/health" || req.url === "/health/ready" || req.url === "/metrics" },
            };
            return { pinoHttp: destination ? [options, destination] : options };
          },
        }),
      ],
    };
  }
}
