import { HttpException, Inject, Injectable, type CallHandler, type ExecutionContext, type NestInterceptor } from "@nestjs/common";
import type { Response } from "express";
import { ZodError } from "zod";
import { catchError, from, mergeMap, throwError, type Observable } from "rxjs";
import type { AuthedRequest } from "../../platform/auth/auth.types.js";
import { ProblemError } from "../../platform/http/problem.js";
import { routeOf, storeOf } from "./staff.guard.js";
import { StaffService } from "./staff.service.js";

/** Every staff call that passed PlatformGuard is a line in the staff trail: the route, the outcome, the store it touched. */
@Injectable()
export class StaffAuditInterceptor implements NestInterceptor {
  constructor(@Inject(StaffService) private readonly staff: StaffService) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    const res = ctx.switchToHttp().getResponse<Response>();
    const auth = req.auth!;
    const line = (outcome: "ok" | "failed", status: number) => this.staff.audit({
      staffId: auth.staff?.id ?? null, userId: auth.user.id, action: routeOf(req), outcome, status, ...storeOf(req), ...(auth.ip ? { ip: auth.ip } : {}),
    });
    return next.handle().pipe(
      mergeMap((body) => from(line("ok", res.statusCode).then(() => body))),
      catchError((e: unknown) => from(line("failed", statusOf(e))).pipe(mergeMap(() => throwError(() => e)))),
    );
  }
}

/** The status the client will get, as ProblemFilter maps it. */
const statusOf = (e: unknown) => e instanceof ProblemError ? e.status : e instanceof ZodError ? 422 : e instanceof HttpException ? e.getStatus() : 500;
