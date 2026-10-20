import type { INestApplication } from "@nestjs/common";
import { DocumentBuilder, SwaggerModule, type OpenAPIObject } from "@nestjs/swagger";
import { MoneySchema } from "@mizan/shared";
import { z } from "zod";
import { APP_VERSION } from "../version.js";
import { ProblemDetailsSchema } from "./http/problem.js";

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
  for (const [name, schema] of Object.entries(COMPONENT_SCHEMAS)) {
    const { $schema: _ignored, ...json } = z.toJSONSchema(schema, { target: "openapi-3.0" }) as Record<string, unknown>;
    doc.components.schemas[name] = json;
  }
  return doc;
}

/** Serve the document as JSON at /v1/openapi.json (the web app generates its client from it). */
export function mountOpenApi(app: INestApplication): void {
  const doc = buildOpenApi(app);
  const http = app.getHttpAdapter();
  http.get("/v1/openapi.json", (_req: unknown, res: { json: (body: unknown) => void }) => res.json(doc));
}
