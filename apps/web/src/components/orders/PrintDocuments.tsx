"use client";

import { Icon } from "@mizan/design-system/icons/react";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { Bdi } from "@/components/Bdi";
import { ProductImage } from "@/components/catalog/ProductImage";
import { Alert } from "@/components/ui/Alert";
import { Button, buttonClass } from "@/components/ui/Button";
import { SkeletonRows } from "@/components/ui/Surface";
import { DateText, MoneyText } from "@/components/ui/Values";
import { Link } from "@/i18n/navigation";
import { ok, type Schemas } from "@/lib/api/client";
import { problemText } from "@/lib/api/query";
import { useSession } from "@/lib/session";

type Doc = Schemas["OrderDocuments"];
type DocOrder = Doc["orders"][number];
export type DocumentKind = Doc["kind"];

/** Where to print these orders' invoices or packing slips (O4): the print page, in this language. */
export const printHref = (kind: DocumentKind, ids: readonly string[]) => `/print/orders?kind=${kind}&ids=${ids.join(",")}`;

/**
 * O4: invoices or packing slips, one page each, in the page's language and direction, always on a
 * light page. The documents carry the delivery contact, so they are fetched for this view only
 * (never kept in the cache) and each order's view is in the audit log.
 */
export function PrintDocuments({ ids, kind }: { ids: string[]; kind: DocumentKind }) {
  const t = useTranslations("orders.print");
  const tpr = useTranslations("problems");
  const { api, user, store } = useSession();
  const docs = useQuery({
    queryKey: ["order-documents", user?.uid ?? "", store?.tenantId ?? "", kind, ids.join(",")],
    queryFn: () => ok(api.POST("/v1/orders/documents", { body: { kind, orderIds: ids } })),
    enabled: Boolean(store) && ids.length > 0,
    gcTime: 0, staleTime: Infinity, retry: false, refetchOnWindowFocus: false,
    meta: { toast: false },
  });
  const other: DocumentKind = kind === "invoice" ? "packing_slip" : "invoice";

  return (
    <div data-theme="light" className="min-h-dvh bg-surface-sunk text-text print:bg-surface">
      <div className="sticky top-0 z-10 flex flex-wrap items-center gap-3 border-b border-line bg-surface px-4 py-3 print:hidden">
        <Link href="/orders" className="inline-flex items-center gap-1.5 text-body-sm text-text-2 hover:text-text"><Icon name="back" size={16} />{t("back")}</Link>
        <span className="text-body-sm text-text-2">{t(kind === "invoice" ? "invoices" : "slips", { count: ids.length })}</span>
        <div className="ms-auto flex flex-wrap gap-2">
          <Link href={printHref(other, ids)} className={buttonClass("secondary", "sm")}>{t(other === "invoice" ? "showInvoices" : "showSlips")}</Link>
          <Button size="sm" icon="print" disabled={!docs.data} onClick={() => window.print()}>{t("print")}</Button>
        </div>
      </div>

      <main className="mx-auto flex max-w-[210mm] flex-col gap-6 px-4 py-6 print:max-w-none print:gap-0 print:p-0">
        {!ids.length ? <Alert tone="warning">{t("none")}</Alert>
          : docs.isPending ? <div className="mz-card"><SkeletonRows rows={6} label={t("loading")} /></div>
          : docs.isError ? <Alert tone="danger">{problemText(docs.error, tpr)}</Alert>
          : docs.data.orders.map((o) => (
            <article key={o.id} data-testid="document" className="mz-card break-inside-avoid break-after-page p-8 print:rounded-none print:border-0 print:shadow-none">
              {kind === "invoice" ? <Invoice doc={docs.data} order={o} /> : <PackingSlip doc={docs.data} order={o} />}
            </article>
          ))}
      </main>
    </div>
  );
}

function Head({ doc, order: o, title }: { doc: Doc; order: DocOrder; title: string }) {
  const t = useTranslations("orders.print");
  return (
    <header className="flex flex-wrap items-start justify-between gap-4 border-b border-line pb-4">
      <div>
        <p className="font-display text-heading-md">{doc.store.name}</p>
        <p className="text-body-sm text-text-2">{title}</p>
      </div>
      <dl className="grid grid-cols-[auto_auto] gap-x-4 gap-y-1 text-body-sm">
        <dt className="text-text-2">{t("number")}</dt><dd><Bdi code>{o.number}</Bdi></dd>
        <dt className="text-text-2">{t("date")}</dt><dd><DateText value={o.placedAt} /></dd>
      </dl>
    </header>
  );
}

function Customer({ order: o }: { order: DocOrder }) {
  const t = useTranslations("orders.print");
  if (!o.customer) return <p className="text-body-sm text-text-2">{t("redacted")}</p>;
  const a = o.customer.address;
  return (
    <section>
      <h2 className="mb-1 text-caption font-medium uppercase text-text-2">{t("shipTo")}</h2>
      <p className="font-medium">{o.customer.name}</p>
      {o.customer.phone ? <p><Bdi code>{o.customer.phone}</Bdi></p> : null}
      <address className="not-italic text-body-sm">
        {[a.line1, a.line2, [a.city, a.province].filter(Boolean).join(" · ")].filter(Boolean).map((l) => <span key={l} className="block">{l}</span>)}
      </address>
    </section>
  );
}

function Invoice({ doc, order: o }: { doc: Doc; order: DocOrder }) {
  const t = useTranslations("orders.print");
  const tm = useTranslations("payments.mode");
  const tp = useTranslations("payments.status");
  const zero = (m: { amount: string }) => Number(m.amount) === 0;
  const totals = [
    { label: t("subtotal"), money: o.subtotal },
    { label: t("shipping"), money: o.shipping },
    ...(zero(o.discount) ? [] : [{ label: t("discount"), money: o.discount }]),
  ];
  return (
    <div className="flex flex-col gap-6">
      <Head doc={doc} order={o} title={t("invoice")} />
      <div className="flex flex-wrap justify-between gap-6">
        <Customer order={o} />
        <section className="text-body-sm">
          <h2 className="mb-1 text-caption font-medium uppercase text-text-2">{t("payment")}</h2>
          <p>{tm(o.paymentMode)}</p>
          <p className="text-text-2">{tp(o.paymentStatus)}</p>
        </section>
      </div>
      <table className="w-full text-body-sm">
        <thead>
          <tr className="border-b border-line text-start text-text-2">
            <th className="py-2 text-start font-medium">{t("item")}</th>
            <th className="py-2 text-end font-medium">{t("qty")}</th>
            <th className="py-2 text-end font-medium">{t("unit")}</th>
            <th className="py-2 text-end font-medium">{t("lineTotal")}</th>
          </tr>
        </thead>
        <tbody>
          {o.lines.map((l, i) => (
            <tr key={i} className="border-b border-line">
              <td className="py-2">{l.title}{l.sku ? <span className="block text-caption text-text-3"><Bdi code>{l.sku}</Bdi></span> : null}</td>
              <td className="py-2 text-end"><Bdi>{l.quantity}</Bdi></td>
              <td className="py-2 text-end"><MoneyText money={l.unitPrice} /></td>
              <td className="py-2 text-end"><MoneyText money={l.total} /></td>
            </tr>
          ))}
        </tbody>
      </table>
      <dl className="ms-auto grid w-full max-w-xs grid-cols-[1fr_auto] gap-x-6 gap-y-1.5 text-body-sm">
        {totals.map((x) => <Row key={x.label} label={x.label} money={x.money} />)}
        <dt className="border-t border-line pt-2 font-medium">{t("total")}</dt>
        <dd className="border-t border-line pt-2 text-end font-medium"><MoneyText money={o.total} /></dd>
        {zero(o.paid) ? null : <Row label={t("paid")} money={o.paid} />}
        {zero(o.refunded) ? null : <Row label={t("refunded")} money={o.refunded} />}
        {zero(o.cod) ? null : (
          <>
            <dt className="font-medium">{t("cod")}</dt>
            <dd className="text-end font-medium"><MoneyText money={o.cod} /></dd>
          </>
        )}
      </dl>
      <p className="text-caption text-text-3">{t("thanks")}</p>
    </div>
  );
}

function Row({ label, money }: { label: string; money: { amount: string; currency: string } }) {
  return (
    <>
      <dt className="text-text-2">{label}</dt>
      <dd className="text-end"><MoneyText money={money} /></dd>
    </>
  );
}

function PackingSlip({ doc, order: o }: { doc: Doc; order: DocOrder }) {
  const t = useTranslations("orders.print");
  return (
    <div className="flex flex-col gap-6">
      <Head doc={doc} order={o} title={t("slip")} />
      <div className="flex flex-wrap items-start justify-between gap-6">
        <Customer order={o} />
        <div className="rounded-lg border-2 border-line-strong px-4 py-3 text-center">
          <p className="text-caption text-text-2">{t("collect")}</p>
          <p className="font-display text-heading-md"><MoneyText money={o.cod} /></p>
        </div>
      </div>
      <table className="w-full text-body-sm">
        <thead>
          <tr className="border-b border-line text-text-2">
            <th className="w-8 py-2" aria-label={t("packed")} />
            <th className="py-2 text-start font-medium">{t("item")}</th>
            <th className="py-2 text-start font-medium">{t("code")}</th>
            <th className="py-2 text-end font-medium">{t("qty")}</th>
          </tr>
        </thead>
        <tbody>
          {o.lines.map((l, i) => (
            <tr key={i} className="border-b border-line">
              <td className="py-2"><span className="block size-5 rounded border-2 border-line-strong" aria-hidden /></td>
              <td className="py-2">
                <span className="flex items-center gap-3">
                  <ProductImage image={l.picture ? { ...l.picture, width: null, height: null } : null} alt="" size={40} />
                  {l.title}
                </span>
              </td>
              <td className="py-2 text-text-2">{l.sku ? <Bdi code>{l.sku}</Bdi> : null}{l.barcode ? <span className="block text-caption"><Bdi code>{l.barcode}</Bdi></span> : null}</td>
              <td className="py-2 text-end text-heading-sm"><Bdi>{l.quantity}</Bdi></td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-body-sm font-medium">{t("pieces", { count: o.pieces })}</p>
    </div>
  );
}
