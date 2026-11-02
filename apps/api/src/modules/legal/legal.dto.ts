import { ACCEPTED_DOCUMENTS, LEGAL_DOCUMENTS } from "@mizan/shared";
import { z } from "zod";

const Version = z.string().regex(/^[0-9]+\.[0-9]+$/, "a version such as 1.0");
const Status = z.enum(["draft", "published"]).describe("draft: under legal review, not in force; published: owners must accept the current terms and DPA");

export const PublicLegalSchema = z.object({
  status: Status,
  documents: z.array(z.object({ key: z.enum(LEGAL_DOCUMENTS), version: Version })),
});
export type PublicLegal = z.infer<typeof PublicLegalSchema>;

export const StoreLegalSchema = z.object({
  status: Status,
  documents: z.array(z.object({
    document: z.enum(ACCEPTED_DOCUMENTS),
    version: Version.describe("The current version"),
    acceptedAt: z.iso.datetime().nullable().describe("When the store accepted the current version; null when it has not"),
    acceptedBy: z.object({ name: z.string().nullable() }).nullable().describe("Who accepted it; null when not accepted or the person was erased"),
  })),
  needsAcceptance: z.boolean().describe("The documents are in force and the store has not accepted a current version: the owner must accept before using the store"),
});
export type StoreLegal = z.infer<typeof StoreLegalSchema>;

/** The versions the person read; they must be the current ones. */
export const LegalVersionsSchema = z.strictObject({ terms: Version, dpa: Version });

export const AcceptLegalSchema = z.strictObject({
  terms: Version.describe("The terms of service version shown"),
  dpa: Version.describe("The data processing agreement version shown"),
  language: z.enum(["ar", "en"]).optional().describe("The language the documents were read in"),
});
export type AcceptLegalBody = z.infer<typeof AcceptLegalSchema>;
