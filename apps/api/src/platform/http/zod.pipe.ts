import { Injectable, type PipeTransform } from "@nestjs/common";
import type { z } from "zod";

/**
 * Validates a request part with a zod schema (usually one from @mizan/shared).
 * A ZodError is turned into 422 validation_failed by ProblemFilter.
 *
 *   @Body(new ZodPipe(CreateOrderSchema)) body: CreateOrder
 */
@Injectable()
export class ZodPipe<T extends z.ZodType> implements PipeTransform<unknown, z.output<T>> {
  constructor(private readonly schema: T) {}

  transform(value: unknown): z.output<T> {
    return this.schema.parse(value);
  }
}
