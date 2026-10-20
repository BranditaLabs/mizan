import { z } from "zod";

/** RFC 9457 problem details, with Mizan's stable `code` and `requestId` (docs/05 §1). */
export interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  code: string;
  detail?: string;
  errors?: Array<{ path: string; code: string; message?: string }>;
  requestId?: string;
}

export const ProblemDetailsSchema = z.object({
  type: z.string(),
  title: z.string(),
  status: z.number().int(),
  code: z.string(),
  detail: z.string().optional(),
  errors: z.array(z.object({ path: z.string(), code: z.string(), message: z.string().optional() })).optional(),
  requestId: z.string().optional(),
}) satisfies z.ZodType<ProblemDetails>;

export const PROBLEM_CONTENT_TYPE = "application/problem+json";
export const problemType = (code: string) => `https://docs.mizan.app/errors/${code}`;

/**
 * Throw from any handler to answer with a specific problem.
 * `detail` is shown to the caller: keep personal data out of it.
 */
export class ProblemError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly detail?: string,
    readonly errors?: ProblemDetails["errors"],
  ) {
    super(detail ?? code);
    this.name = "ProblemError";
  }
}
