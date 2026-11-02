import type { INestApplication } from "@nestjs/common";
import { DocumentBuilder, SwaggerModule, type OpenAPIObject } from "@nestjs/swagger";
import { MoneySchema } from "@mizan/shared";
import type { z } from "zod";
import { APP_VERSION } from "../version.js";
import { registeredSchemas, toJsonSchema } from "./http/api-schema.js";
import { PROBLEM_CONTENT_TYPE, ProblemDetailsSchema } from "./http/problem.js";

/** Shared zod schemas published as reusable OpenAPI components. Modules add theirs here. */
const COMPONENT_SCHEMAS: Record<string, z.ZodType> = {
  Money: MoneySchema,
  ProblemDetails: ProblemDetailsSchema,
};

export function buildOpenApi(app: INestApplication): OpenAPIObject {
  const config = new DocumentBuilder()
    .setOpenAPIVersion("3.1.0")
    .setTitle("Mizan API")
    .setDescription("MENA e-commerce operating system. Conventions: docs/05-api.md.")
    .setVersion(APP_VERSION)
    .addBearerAuth({ type: "http", scheme: "bearer", description: "Firebase ID token or mz_live_ API key" })
    .addSecurityRequirements("bearer")
    .addGlobalParameters(
      { name: "Accept-Language", in: "header", required: false, schema: { type: "string", enum: ["ar", "en"] } },
      { name: "X-Tenant-Id", in: "header", required: false, description: "Store id; required on store routes", schema: { type: "string", format: "uuid" } },
    )
    .build();
  const doc = SwaggerModule.createDocument(app, config);
  doc.components ??= {};
  doc.components.schemas ??= {};
  for (const [name, schema] of Object.entries(COMPONENT_SCHEMAS)) doc.components.schemas[name] = toJsonSchema(schema, "output");
  Object.assign(doc.components.schemas, registeredSchemas());

  // Every error is a problem (docs/05 §1): a `default` response types it for the generated client.
  const problem = { description: "Problem (RFC 9457) with a stable `code`", content: { [PROBLEM_CONTENT_TYPE]: { schema: { $ref: "#/components/schemas/ProblemDetails" } } } };
  for (const [path, item] of Object.entries(doc.paths)) {
    for (const op of Object.values(item) as Array<{ responses?: Record<string, unknown>; security?: unknown[] }>) {
      if (!op || typeof op !== "object" || !("responses" in op)) continue;
      op.responses = { ...op.responses, default: problem };
      if (!path.startsWith("/v1/")) op.security = []; // probes are public
    }
  }
  doc.components.schemas = Object.fromEntries(Object.entries(doc.components.schemas).sort(([a], [b]) => a.localeCompare(b)));
  return doc;
}

/** Serve the document as JSON at /v1/openapi.json (the web app generates its client from it). */
export function mountOpenApi(app: INestApplication): void {
  const doc = buildOpenApi(app);
  const http = app.getHttpAdapter();
  http.get("/v1/openapi.json", (_req: unknown, reply: { send: (body: unknown) => void }) => reply.send(doc));
}
