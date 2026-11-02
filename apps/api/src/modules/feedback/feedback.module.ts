import { Module } from "@nestjs/common";
import { StaffModule } from "../staff/staff.module.js";
import { FeedbackController, PlatformFeedbackController } from "./feedback.controller.js";
import { FeedbackService } from "./feedback.service.js";

/** In-app feedback (L1-8): store members send it; Mizan staff read it in the back office. */
@Module({ imports: [StaffModule], controllers: [FeedbackController, PlatformFeedbackController], providers: [FeedbackService] })
export class FeedbackModule {}
