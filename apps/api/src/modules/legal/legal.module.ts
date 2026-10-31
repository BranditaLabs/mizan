import { Module, type DynamicModule } from "@nestjs/common";
import { LEGAL_STATUS, type LegalStatus } from "@mizan/shared";
import { PublicLegalController, StoreLegalController } from "./legal.controller.js";
import { LEGAL_STATUS_TOKEN, LegalService } from "./legal.service.js";

/** Legal documents and their acceptance per store (L1-3). The status comes from @mizan/shared; tests may replace it. */
@Module({})
export class LegalModule {
  static forRoot(status: LegalStatus = LEGAL_STATUS): DynamicModule {
    return {
      module: LegalModule,
      controllers: [PublicLegalController, StoreLegalController],
      providers: [{ provide: LEGAL_STATUS_TOKEN, useValue: status }, LegalService],
    };
  }
}
