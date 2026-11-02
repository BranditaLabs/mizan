# ADR-0013: Fastify as the API's HTTP adapter

- **Status:** Accepted
- **Date:** 2026-10-27

## Context

H-11's load tests showed one API process doing ~400–520 authenticated reads/s on the reference VM, CPU-bound, with ~0.55 ms per request spent in the framework and its middleware (Express, helmet, cors, compression, body-parser) before any of our code. H-12 asked for +30 % per instance. A prototype of the same Nest controller measured ~5,100 req/s on Express and ~17,500 req/s on Fastify on the same machine.

## Decision

The API (NestJS, ADR-0003) runs on `@nestjs/platform-fastify` instead of Express:

- Security headers through `@fastify/helmet`, compression through `@fastify/compress`, CORS through Nest's `enableCors` (`@fastify/cors`); same policies as before.
- One content-type parser: webhooks get their exact bytes (signatures, H-5) and their own size cap; everything else is JSON or a form up to `MAX_BODY_BYTES`. Parse and size errors are `ProblemError`s; Fastify's own `FST_*` request errors are mapped in `ProblemFilter` (Nest owns Fastify's error handler).
- HTTP metrics are an `onResponse` hook (route template from `routeOptions.url`); request ids come from Fastify's `genReqId` (the caller's `X-Request-Id` when well-formed) and are echoed on every response.
- `FastifyReady` makes Fastify ready on application bootstrap, so `app.init()` alone (tests, load harness) serves like `listen()`.
- Controllers that need the reply use the Fastify API (`code`, `header`, `send`, `redirect(url, code)`), through `HttpRequest`/`HttpReply` in `platform/http/http.types.ts`.

## Consequences

- Measured on the reference VM (docs/perf): one instance `reads-max` 750–822/s (was ~485–558), `health-max` 2,150–2,450/s (was ~1,300); two instances `health-max` 4,887/s (was 3,454–3,911); every H-11 gate still passes with every acknowledged webhook recorded.
- Express middleware cannot be dropped in; Fastify plugins or hooks are used instead. `req`/`res` in guards and interceptors are Fastify's (`req.raw` is Node's `IncomingMessage`).
- All 519 API tests, the web (62) and back-office (4) browser suites pass unchanged in behaviour.
