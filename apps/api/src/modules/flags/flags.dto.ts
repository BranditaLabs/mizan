import { z } from "zod";
import { PLANS } from "../billing/plans.js";

export const FLAG_KEY = /^[a-z][a-z0-9_.]{2,60}$/;
export const FlagKeyParam = z.string().regex(FLAG_KEY, "3–61 characters: a-z, 0-9, dot and underscore, starting with a letter");

const Flag = z.object({
  key: z.string(), description: z.string(), enabled: z.boolean().describe("For every store without its own setting"),
  stores: z.array(z.object({ storeId: z.uuid(), storeName: z.string(), enabled: z.boolean() })).describe("Stores with their own setting"),
  updatedAt: z.iso.datetime(),
});
export const FlagSchema = Flag;
export const FlagsSchema = z.object({ data: z.array(Flag) });
export const PutFlagSchema = z.strictObject({ enabled: z.boolean(), description: z.string().trim().max(500).optional() });
export const PutStoreFlagSchema = z.strictObject({ enabled: z.boolean() });
export const StoreFlagsSchema = z.object({ flags: z.record(z.string(), z.boolean()).describe("Every flag, as it applies to this store") });

const Level = z.enum(["info", "warning", "critical"]);
export const CreateAnnouncementSchema = z.strictObject({
  level: Level.default("info"),
  titleAr: z.string().trim().min(1).max(120), titleEn: z.string().trim().min(1).max(120),
  bodyAr: z.string().trim().max(1000).default(""), bodyEn: z.string().trim().max(1000).default(""),
  link: z.url({ protocol: /^https$/ }).max(500).optional(),
  plans: z.array(z.enum(PLANS)).min(1).optional().describe("Only stores on these plans; every plan when left out"),
  countries: z.array(z.string().regex(/^[A-Z]{2}$/)).min(1).optional().describe("Only stores in these countries"),
  startsAt: z.iso.datetime().optional(),
  endsAt: z.iso.datetime(),
}).refine((b) => Date.parse(b.endsAt) > (b.startsAt ? Date.parse(b.startsAt) : Date.now()), { message: "endsAt must be after the start", path: ["endsAt"] });
const Announcement = z.object({
  id: z.uuid(), level: Level, titleAr: z.string(), titleEn: z.string(), bodyAr: z.string(), bodyEn: z.string(), link: z.string().nullable(),
  plans: z.array(z.string()).nullable(), countries: z.array(z.string()).nullable(), startsAt: z.iso.datetime(), endsAt: z.iso.datetime(), createdAt: z.iso.datetime(),
});
export const AnnouncementSchema = Announcement;
export const AnnouncementsSchema = z.object({ data: z.array(Announcement) });
export const AnnouncementsQuerySchema = z.object({ live: z.enum(["true", "false"]).optional().transform((v) => v === "true") });
const StoreAnnouncement = z.object({ id: z.uuid(), level: Level, titleAr: z.string(), titleEn: z.string(), bodyAr: z.string(), bodyEn: z.string(), link: z.string().nullable(), endsAt: z.iso.datetime() });
export const StoreAnnouncementsSchema = z.object({ data: z.array(StoreAnnouncement).describe("Most serious first; both languages, the dashboard shows its own") });
