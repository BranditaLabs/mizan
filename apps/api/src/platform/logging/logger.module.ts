import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { Global, Module, type DynamicModule } from "@nestjs/common";
import { LoggerModule as PinoLoggerModule } from "nestjs-pino";
import { destination as pinoDestination, type DestinationStream, type LoggerOptions } from "pino";
import { APP_CONFIG, type AppConfig } from "../config.js";
import { PINO_REDACT_PATHS, REDACTED, redactDeep, scrubText, scrubUrl } from "./redact.js";

const REQUEST_ID = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * Scrub every string of a log record, except the serialized fields: walking a raw
 * IncomingMessage / ServerResponse on every request line was the API's largest CPU cost (H-11).
 */
export function redactLogRecord(obj: Record<string, unknown>): Record<string, unknown> {
  // req, res and err have their own serializers, which keep only safe values (they run after formatters.log).
  const { req, res, err, ...rest } = obj;
  const out = redactDeep(rest) as Record<string, unknown>;
  if (req !== undefined) out.req = req;
  if (res !== undefined) out.res = res;
  if (err !== undefined) out.err = err;
  return out;
}

/**
 * stdout through an async buffer: lines are written in 4 KiB batches or every 250 ms,
 * instead of one write syscall per line. pino flushes it synchronously on exit.
 */
export function bufferedDestination(dest: number | string = 1): DestinationStream {
  return pinoDestination({ dest, sync: false, minLength: 4096, periodicFlush: 250 } as Parameters<typeof pinoDestination>[0]);
}

/** The caller's X-Request-Id when well-formed, else a new one. */
export const requestIdFrom = (incoming: string | string[] | undefined): string =>
  typeof incoming === "string" && REQUEST_ID.test(incoming) ? incoming : `req_${randomUUID().replaceAll("-", "")}`;

/** pino-http's id (the HTTP adapter usually set one already on the raw request), echoed as X-Request-Id. */
export function requestIdFor(req: IncomingMessage, res: ServerResponse): string {
  const existing = (req as { id?: unknown }).id;
  const id = typeof existing === "string" ? existing : requestIdFrom(req.headers["x-request-id"]);
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
      log: redactLogRecord,
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
    ...((config.LOG_FORMAT ?? (config.NODE_ENV === "development" ? "pretty" : "json")) === "pretty"
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
            const pretty = "transport" in options && options.transport;
            const dest = destination ?? (pretty ? undefined : bufferedDestination());
            return { pinoHttp: dest ? [options, dest] : options };
          },
        }),
      ],
    };
  }
}
