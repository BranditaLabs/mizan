/**
 * A JSON body with every UUID replaced by "<id>", for personal-data checks: random ids hold any
 * hex digits ("101234cb-…"), so a search for a phone fragment like "0123" must not see them.
 */
export const withoutIds = (body: unknown): string =>
  JSON.stringify(body).replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "<id>");
