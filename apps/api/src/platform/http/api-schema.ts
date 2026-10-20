import { applyDecorators } from "@nestjs/common";
import { ApiBody, ApiQuery, ApiResponse } from "@nestjs/swagger";
import { z } from "zod";
import { PROBLEM_CONTENT_TYPE } from "./problem.js";

/**
 * Zod schemas → OpenAPI (E4-4). The same schema validates the request (ZodPipe) or types the
 * response (`z.infer`) and is published as a named component, so the generated web client
 * (apps/web/src/lib/api/schema.d.ts) cannot drift from what the API does.
 *
 *   @ApiJsonBody("CreateTenant", CreateTenantSchema)
 *   @ApiJson(201, "Tenant", TenantViewSchema, "The new store")
 *   @ApiProblems(409, 422)
 */
type Entry = { schema: z.ZodType; io: "input" | "output" };
const registry = new Map<string, Entry>();

/** Register a named schema (once per name) and return its $ref. */
export function schemaRef(name: string, schema: z.ZodType, io: Entry["io"] = "output"): { $ref: string } {
  const existing = registry.get(name);
  if (existing && existing.schema !== schema) throw new Error(`OpenAPI schema name used for two schemas: ${name}`);
  registry.set(name, { schema, io });
  return { $ref: `#/components/schemas/${name}` };
}

export function toJsonSchema(schema: z.ZodType, io: Entry["io"]): Record<string, unknown> {
  const { $schema: _ignored, ...json } = z.toJSONSchema(schema, { target: "openapi-3.0", io, unrepresentable: "any" }) as Record<string, unknown>;
  return json;
}

/** Every schema registered so far, as OpenAPI components. */
export function registeredSchemas(): Record<string, Record<string, unknown>> {
  return Object.fromEntries([...registry].map(([name, e]) => [name, toJsonSchema(e.schema, e.io)]));
}

/** The zod schema behind a component name (contract tests validate real responses with it). */
export function registeredSchema(name: string): z.ZodType | undefined {
  return registry.get(name)?.schema;
}

/** JSON request body validated by the same schema in ZodPipe. */
export const ApiJsonBody = (name: string, schema: z.ZodType) =>
  ApiBody({ required: true, schema: schemaRef(name, schema, "input") });

/** A JSON response with a named schema. */
export const ApiJson = (status: number, name: string, schema: z.ZodType, description: string) =>
  ApiResponse({ status, description, content: { "application/json": { schema: schemaRef(name, schema) } } });

/** A response without a body. */
export const ApiNoContent = (description: string) => ApiResponse({ status: 204, description });

const PROBLEM_DESCRIPTIONS: Record<number, string> = {
  400: "Invalid request (validation_failed, …)",
  401: "Not signed in or token expired",
  403: "Not allowed (not_a_member, insufficient_role, mfa_required)",
  404: "Not found",
  409: "Conflict with the current state",
  422: "Understood but refused (a business rule)",
  503: "A dependency is down",
};

/** Problem responses specific to this route (every route also has a `default` problem response). */
export const ApiProblems = (...statuses: number[]) =>
  applyDecorators(...statuses.map((status) => ApiResponse({
    status,
    description: PROBLEM_DESCRIPTIONS[status] ?? "Problem",
    content: { [PROBLEM_CONTENT_TYPE]: { schema: { $ref: "#/components/schemas/ProblemDetails" } } },
  })));

/** Query parameters from a zod object (the one ZodPipe validates). */
export function ApiQueryZod(schema: z.ZodObject) {
  return applyDecorators(...Object.entries(schema.shape).map(([name, field]) => {
    const json = toJsonSchema(field as z.ZodType, "input");
    return ApiQuery({ name, required: !(field as z.ZodType).safeParse(undefined).success, schema: json as never, description: json.description as string | undefined });
  }));
}
