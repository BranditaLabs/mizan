import { Global, Module } from "@nestjs/common";
import { RetentionService } from "./retention.service.js";

@Global()
@Module({ providers: [RetentionService], exports: [RetentionService] })
export class MaintenanceModule {}
