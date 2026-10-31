"use client";

import { toAsciiDigits } from "@mizan/shared";
import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { Bdi } from "@/components/Bdi";
import { Alert } from "@/components/ui/Alert";
import { Badge } from "@/components/ui/Badge";
import { Button, ButtonGroup } from "@/components/ui/Button";
import { Cell, DataTable, IdCell, type Column } from "@/components/ui/DataTable";
import { Dialog } from "@/components/ui/Dialog";
import { Field, SearchInput, TextArea } from "@/components/ui/Field";
import { StatCard } from "@/components/ui/StatCard";
import { EmptyState, SkeletonRows } from "@/components/ui/Surface";
import { Tabs } from "@/components/ui/Tabs";
import { useToast } from "@/components/ui/Toast";
import { MoneyText } from "@/components/ui/Values";
import { ApiError, ok, type Schemas } from "@/lib/api/client";
import { downloadText, toCsv } from "@/lib/csv";
import { useSession } from "@/lib/session";

type Product = Schemas["ProductPage"]["data"][number];
type Variant = Schemas["CatalogVariant"];
type Row = { product: Product; variant: Variant };
type Filter = "all" | "cost" | "barcode";
const FILTERS: readonly Filter[] = ["all", "cost", "barcode"];
const EDITORS = new Set(["owner", "admin", "ops_manager", "finance"]);
const PROBLEMS = new Set(["header", "columns", "sku", "cost", "barcode", "duplicate", "too_many", "empty", "unknown_sku", "barcode_taken"]);
const BARCODE = /^[\x21-\x7E]{1,64}$/;
const DECIMAL = /^\d{1,12}(\.\d{1,3})?$/;

/**
 * Products (M4, E8-1): what the store sells, with the two things Mizan adds — the cost (so profit
 * is real) and the barcode (so the warehouse can scan). Title, price, SKU and stock come from the
 * store and are changed there. Costs can be typed one by one or imported from a sheet: download
 * the list, fill the cost column, import it back.
 */
export function Products() {
  const t = useTranslations("products");
  const { api, user, store } = useSession();
  const allowed = EDITORS.has(store?.role ?? "");
  const [filter, setFilter] = useState<Filter>("all");
  const [text, setText] = useState("");
  const [q, setQ] = useState("");
  const [editing, setEditing] = useState<Row | null>(null);
  const [importing, setImporting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const toast = useToast();

  useEffect(() => {
    const id = setTimeout(() => setQ(text.trim()), 300);
    return () => clearTimeout(id);
  }, [text]);

  const query = (cursor: string, limit = 50) => ({
    ...(q ? { search: q } : {}), ...(filter === "all" ? {} : { missing: filter }), limit, ...(cursor ? { cursor } : {}),
  });
  const products = useInfiniteQuery({
    queryKey: ["products", user?.uid ?? "", store?.tenantId ?? "", filter, q],
    queryFn: ({ pageParam }) => ok(api.GET("/v1/products", { params: { query: query(pageParam) } })),
    initialPageParam: "",
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: Boolean(store) && allowed,
  });

  /** The whole list as a sheet (up to 5,000 products): fill the cost column and import it back. */
  const exportCsv = async () => {
    setExporting(true);
    try {
      const all: Product[] = [];
      let cursor = "";
      for (let i = 0; i < 50; i++) {
        const page = await ok(api.GET("/v1/products", { params: { query: query(cursor, 100) } }));
        all.push(...page.data);
        if (!page.nextCursor) break;
        cursor = page.nextCursor;
      }
      const head = [t("csv.product"), t("csv.variant"), t("csv.sku"), t("csv.barcode"), t("csv.price"), t("csv.cost")];
      const lines = all.flatMap((p) => p.variants.map((v) => [p.title, v.title, v.sku, v.barcode, v.price.amount, v.cost?.amount ?? null]));
      downloadText(`mizan-products-${new Date().toISOString().slice(0, 10)}.csv`, toCsv([head, ...lines]));
    } catch {
      toast({ message: t("exportFailed") });
    } finally {
      setExporting(false);
    }
  };

  const frame = (body: React.ReactNode, actions?: React.ReactNode) => (
    <div className="mx-auto flex max-w-[1440px] flex-col gap-5 px-4 pt-6 pb-14 md:px-6" data-testid="products">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-heading-lg">{t("title")}</h1>
          <p className="mt-1 max-w-[70ch] text-body-sm text-text-2">{t("subtitle")}</p>
        </div>
        {actions}
      </header>
      {body}
    </div>
  );
  if (!allowed) return frame(<div className="mz-card"><EmptyState icon="locked" title={t("notAllowed.title")} body={t("notAllowed.body")} /></div>);

  const first = products.data?.pages[0];
  const counts = first?.counts;
  const rows: Row[] = (products.data?.pages ?? []).flatMap((p) => p.data.flatMap((product) => product.variants.map((variant) => ({ product, variant }))));
  const columns: Column<Row>[] = [
    {
      id: "product", header: t("col.product"),
      cell: ({ product, variant }) => <Cell main={product.title} sub={[variant.title, product.status !== "active" ? t(`status.${product.status}`) : null].filter(Boolean).join(" · ") || null} />,
    },
    { id: "sku", header: t("col.sku"), cell: ({ variant }) => <IdCell>{variant.sku}</IdCell> },
    {
      id: "barcode", header: t("col.barcode"),
      cell: ({ variant }) => variant.barcode
        ? <Cell main={<IdCell>{variant.barcode}</IdCell>} sub={t(`owner.${variant.barcodeOwner}`)} />
        : <span className="text-text-3">{t("none")}</span>,
    },
    { id: "price", header: t("col.price"), numeric: true, cell: ({ variant }) => <MoneyText money={variant.price} />, sortValue: ({ variant }) => Number(variant.price.amount) },
    {
      id: "cost", header: t("col.cost"), numeric: true,
      cell: ({ variant }) => variant.cost ? <MoneyText money={variant.cost} /> : <Badge tone="warning">{t("missingCost")}</Badge>,
      sortValue: ({ variant }) => (variant.cost ? Number(variant.cost.amount) : -1),
    },
    { id: "stock", header: t("col.stock"), numeric: true, cell: ({ variant }) => (variant.available === null ? <span className="text-text-3">{t("none")}</span> : <Bdi>{variant.available}</Bdi>) },
    {
      id: "edit", header: t("col.actions"),
      cell: (r) => <Button size="sm" variant="ghost" icon="edit" onClick={() => setEditing(r)} aria-label={t("editLabel", { sku: r.variant.sku })}>{t("edit")}</Button>,
    },
  ];
  const empty = q ? <EmptyState icon="search" title={t("noMatch.title")} body={t("noMatch.body")} />
    : counts?.products === 0 ? <EmptyState icon="product" title={t("empty.title")} body={t("empty.body")} />
    : <EmptyState icon="success" title={t("allSet.title")} body={t("allSet.body")} />;

  return frame(
    <>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4" data-testid="product-counts">
        <StatCard label={t("count.products")} value={counts?.products ?? "…"} />
        <StatCard label={t("count.variants")} value={counts?.variants ?? "…"} />
        <StatCard label={t("count.missingCost")} value={counts?.missingCost ?? "…"} />
        <StatCard label={t("count.missingBarcode")} value={counts?.missingBarcode ?? "…"} />
      </div>
      <Tabs label={t("filterLabel")} value={filter} onChange={setFilter}
        items={FILTERS.map((f) => ({ value: f, label: t(`filter.${f}`), ...(counts && f !== "all" ? { count: f === "cost" ? counts.missingCost : counts.missingBarcode } : {}) }))}>
        <div className="flex flex-col gap-3">
          <SearchInput label={t("search")} placeholder={t("search")} value={text} onChange={(e) => setText(e.target.value)} className="w-full sm:w-80" />
          {products.isPending ? <div className="mz-card"><SkeletonRows rows={6} label={t("loading")} /></div> : null}
          {products.isError ? <Alert tone="danger">{t("loadFailed")}</Alert> : null}
          {products.data ? <DataTable label={t("label")} columns={columns} rows={rows} rowKey={(r) => r.variant.id} rowLabel={(r) => r.variant.sku} empty={empty} /> : null}
          {products.hasNextPage ? (
            <div className="flex justify-center">
              <Button variant="secondary" busy={products.isFetchingNextPage} onClick={() => void products.fetchNextPage()}>{t("more")}</Button>
            </div>
          ) : null}
          <p className="text-caption text-text-3">{t("ownership")}</p>
        </div>
      </Tabs>
      {editing ? <EditVariant row={editing} onClose={() => setEditing(null)} /> : null}
      <ImportCosts open={importing} onClose={() => setImporting(false)} />
    </>,
    <ButtonGroup>
      <Button variant="secondary" icon="download" busy={exporting} disabled={!counts?.products} onClick={() => void exportCsv()}>{t("download")}</Button>
      <Button icon="upload" onClick={() => setImporting(true)}>{t("import.open")}</Button>
    </ButtonGroup>,
  );
}

/** One variant's cost and barcode; a barcode set here stays through store syncs until given back. */
function EditVariant({ row, onClose }: { row: Row; onClose(): void }) {
  const t = useTranslations("products.editor");
  const { api } = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const { variant, product } = row;
  const [cost, setCost] = useState(variant.cost?.amount ?? "");
  const [barcode, setBarcode] = useState(variant.barcode ?? "");
  const costValue = toAsciiDigits(cost.trim()).replace(/٫/g, ".");
  const barcodeValue = toAsciiDigits(barcode.trim());
  const costOk = costValue === "" || DECIMAL.test(costValue);
  const barcodeOk = barcodeValue === "" || BARCODE.test(barcodeValue);
  const save = useMutation({
    mutationFn: (body: Schemas["UpdateVariant"]) => ok(api.PATCH("/v1/products/variants/{id}", { params: { path: { id: variant.id } }, body })),
    onSuccess: () => { toast({ message: t("saved", { sku: variant.sku }) }); void qc.invalidateQueries({ queryKey: ["products"] }); onClose(); },
  });
  const body: Schemas["UpdateVariant"] = {
    ...(costValue && costValue !== variant.cost?.amount ? { cost: costValue } : {}),
    ...(barcodeValue && barcodeValue !== variant.barcode ? { barcode: barcodeValue } : {}),
  };
  const taken = save.error instanceof ApiError && save.error.code === "barcode_taken";
  return (
    <Dialog open onClose={onClose} title={t("title", { sku: variant.sku })} description={[product.title, variant.title].filter(Boolean).join(" · ")}
      footer={(
        <ButtonGroup>
          <Button busy={save.isPending} disabled={!costOk || !barcodeOk || Object.keys(body).length === 0} onClick={() => save.mutate(body)}>{t("save")}</Button>
          <Button variant="ghost" onClick={onClose}>{t("close")}</Button>
        </ButtonGroup>
      )}>
      <div className="flex flex-col gap-4" data-testid="variant-editor">
        <Field label={t("cost", { currency: variant.price.currency })} hint={t("costHint")} inputMode="decimal" ltr value={cost}
          onChange={(e) => setCost(e.target.value)} error={costOk ? null : t("costInvalid")} />
        <Field label={t("barcode")} hint={variant.barcodeOwner === "mizan" ? t("barcodeMizan") : t("barcodeStore")} ltr value={barcode}
          onChange={(e) => setBarcode(e.target.value)} error={!barcodeOk ? t("barcodeInvalid") : taken ? t("barcodeTaken") : null} />
        {variant.barcodeOwner === "mizan" ? (
          <div><Button size="sm" variant="ghost" busy={save.isPending} onClick={() => save.mutate({ barcode: null })}>{t("useStore")}</Button></div>
        ) : null}
        <p className="text-caption text-text-3">{t("storeFields")}</p>
      </div>
    </Dialog>
  );
}

/** A costs sheet: every line applied, or nothing and each bad line named. */
function ImportCosts({ open, onClose }: { open: boolean; onClose(): void }) {
  const t = useTranslations("products.import");
  const { api } = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const [csv, setCsv] = useState("");
  const run = useMutation({
    mutationFn: () => ok(api.POST("/v1/products/costs/import", { body: { csv } })),
    onSuccess: (r) => {
      setCsv("");
      toast({ message: t("done", { costs: r.costs, barcodes: r.barcodes }) });
      void qc.invalidateQueries({ queryKey: ["products"] });
      onClose();
    },
    onError: (e) => { if (!(e instanceof ApiError && e.code === "csv_invalid")) toast({ message: e instanceof ApiError && e.title ? e.title : t("failed") }); },
  });
  const lines = run.error instanceof ApiError && run.error.code === "csv_invalid" ? run.error.errors ?? [] : [];
  const readFile = async (file: File | undefined) => { if (file) { setCsv(await file.text()); run.reset(); } };
  return (
    <Dialog open={open} onClose={onClose} title={t("title")} description={t("body")}
      footer={(
        <ButtonGroup>
          <Button icon="upload" disabled={!csv.trim()} busy={run.isPending} onClick={() => run.mutate()}>{t("run")}</Button>
          <Button variant="ghost" onClick={onClose}>{t("close")}</Button>
        </ButtonGroup>
      )}>
      <div className="flex flex-col gap-3" data-testid="cost-import">
        <label className="flex flex-col gap-1 text-label">
          {t("file")}
          <input type="file" accept=".csv,text/csv" className="text-body-sm" onChange={(e) => void readFile(e.target.files?.[0])} />
        </label>
        <TextArea label={t("paste")} hint={t("pasteHint")} rows={4} dir="ltr" value={csv} onChange={(e) => { setCsv(e.target.value); run.reset(); }} />
        {lines.length ? (
          <Alert tone="danger" title={t("invalid", { count: lines.length })}>
            <ul className="mt-1 flex flex-col gap-0.5" data-testid="cost-import-errors">
              {lines.slice(0, 10).map((p) => (
                <li key={`${p.path}-${p.code}`}>
                  {t.rich("line", { line: p.path.replace("line:", ""), n: (c) => <Bdi>{c}</Bdi> })}{" · "}{t(`problem.${PROBLEMS.has(p.code) ? p.code : "other"}`)}
                  {p.message ? <>{" · "}<Bdi>{p.message}</Bdi></> : null}
                </li>
              ))}
            </ul>
          </Alert>
        ) : null}
      </div>
    </Dialog>
  );
}
