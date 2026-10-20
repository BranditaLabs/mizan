import { Catch, HttpException, HttpStatus, Logger, type ArgumentsHost, type ExceptionFilter } from "@nestjs/common";
import type { Request, Response } from "express";
import { ZodError } from "zod";
import { localeFrom, problemTitle } from "../i18n/messages.js";
import { scrubText } from "../logging/redact.js";
import { PROBLEM_CONTENT_TYPE, ProblemError, problemType, type ProblemDetails } from "./problem.js";

const CODE_BY_STATUS: Record<number, string> = {
  400: "bad_request",
  401: "unauthorized",
  403: "forbidden",
  404: "not_found",
  405: "method_not_allowed",
  409: "conflict",
  412: "precondition_failed",
  413: "payload_too_large",
  422: "validation_failed",
  429: "rate_limited",
  503: "service_unavailable",
};

const codeForStatus = (status: number) => CODE_BY_STATUS[status] ?? (status >= 500 ? "internal_error" : "bad_request");

/**
 * Turns every error into RFC 9457 problem+json (docs/05 §1).
 * Unexpected errors become a generic 500: the stack and message are logged
 * (redacted), never sent to the client.
 */
@Catch()
export class ProblemFilter implements ExceptionFilter {
  private readonly logger = new Logger("ProblemFilter");

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const req = http.getRequest<Request & { id?: string }>();
    const res = http.getResponse<Response>();
    const locale = localeFrom(req.headers["accept-language"]);

    const problem = this.toProblem(exception);
    const body: ProblemDetails = {
      type: problemType(problem.code),
      title: problemTitle(problem.code, locale) ?? problemTitle(codeForStatus(problem.status), locale) ?? problem.code,
      status: problem.status,
      code: problem.code,
      ...(problem.detail ? { detail: problem.detail } : {}),
      ...(problem.errors?.length ? { errors: problem.errors } : {}),
      ...(req.id ? { requestId: String(req.id) } : {}),
    };

    if (problem.status >= 500) this.logger.error({ err: exception, requestId: req.id }, "unhandled error");

    res.status(problem.status).type(PROBLEM_CONTENT_TYPE).send(JSON.stringify(body));
  }

  private toProblem(exception: unknown): Pick<ProblemDetails, "status" | "code" | "detail" | "errors"> {
    if (exception instanceof ProblemError) {
      return { status: exception.status, code: exception.code, detail: exception.detail, errors: exception.errors };
    }
    if (exception instanceof ZodError) {
      return {
        status: HttpStatus.UNPROCESSABLE_ENTITY,
        code: "validation_failed",
        errors: exception.issues.map((i) => ({ path: i.path.join("."), code: i.code, message: i.message })),
      };
    }
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      // Nest's own messages ("Cannot GET /x") are shown without the query string (it may carry
      // personal data) and scrubbed; 5xx details are never shown.
      const detail = status < 500 ? scrubText(exception.message.replace(/\?\S*/, "")) : undefined;
      return { status, code: codeForStatus(status), detail };
    }
    return { status: HttpStatus.INTERNAL_SERVER_ERROR, code: "internal_error" };
  }
}
