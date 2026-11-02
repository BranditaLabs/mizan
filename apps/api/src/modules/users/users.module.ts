import { Module } from "@nestjs/common";
import { MembersModule } from "../members/members.module.js";
import { MeController } from "./me.controller.js";

@Module({ imports: [MembersModule], controllers: [MeController] })
export class UsersModule {}
