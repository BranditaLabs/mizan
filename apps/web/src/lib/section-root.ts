/** An id in a path (an order, a product, a PO): uuids and numbers. */
const ID = /^(?:[0-9a-f]{8}-[0-9a-f-]{27}|\d+)$/i;

/** Where to land in another store: the same page, cut before the first id (this store's order means nothing there). */
export function sectionRoot(pathname: string): string {
  const parts = pathname.split("/").filter(Boolean);
  const cut = parts.findIndex((p) => ID.test(p));
  return `/${(cut === -1 ? parts : parts.slice(0, cut)).join("/")}`;
}
