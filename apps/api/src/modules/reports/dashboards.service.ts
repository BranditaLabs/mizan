import { Inject, Injectable } from "@nestjs/common";
import { fromMinor } from "@mizan/shared";
import type { AuthContext } from "../../platform/auth/auth.types.js";
import { Database } from "../../platform/db/database.js";
import { ProblemError } from "../../platform/http/problem.js";
import { csv, xlsx, type Cell } from "../../platform/xlsx.js";
import { storeClock } from "../profit/store-day.js";
import { DASHBOARDS, dashboardById, SERIES_NAMES, SERIES_ROLES, type DashboardId } from "./dashboards.js";
import type { Dashboard, DashboardQuery } from "./dashboards.dto.js";
import { metricByKey } from "./metrics.js";
import { MetricsService } from "./metrics.service.js";

/**
 * The built-in dashboards (E15-2): tiles from the metric layer and daily series, in the reader's
 * language, each role seeing only what it may; and the same content as a CSV or Excel file.
 */
@Injectable()
export class DashboardsService {
  constructor(
    @Inject(Database) private readonly db: Database,
    @Inject(MetricsService) private readonly metrics: MetricsService,
  ) {}

  list(auth: AuthContext) {
    const lang = auth.user.language;
    const visible = this.metrics.visibleKeys(auth);
    return { data: DASHBOARDS.filter((d) => d.metrics.some((m) => visible.has(m))).map((d) => ({ id: d.id, name: d.name[lang] })) };
  }

  async get(auth: AuthContext, id: string, q: DashboardQuery, now = new Date()): Promise<Dashboard> {
    const d = dashboardById.get(id as DashboardId);
    const visible = this.metrics.visibleKeys(auth);
    if (!d || !d.metrics.some((m) => visible.has(m))) throw new ProblemError(404, "not_found", "no such dashboard");
    const lang = auth.user.language;
    const role = auth.tenant!.role;
    const tenantId = auth.tenant!.id;
    return this.db.tenant(tenantId, async (trx) => {
      const { base, timezone } = await storeClock(trx, tenantId);
      const { from, to } = this.metrics.period(q, timezone, now);
      const facts = await this.metrics.facts(trx, tenantId, base, timezone, from, to);
      const series = d.series.filter((s) => SERIES_ROLES[s].has(role));
      const daily = series.length ? await this.metrics.daily(trx, base, timezone, from, to) : [];
      return {
        id: d.id, name: d.name[lang], from, to, currency: base,
        tiles: d.metrics.filter((k) => visible.has(k)).map((k) => {
          const m = metricByKey.get(k)!;
          const v = m.compute(facts);
          return { key: m.key, name: m.name[lang], definition: m.definition[lang], unit: m.unit, value: v.value, ...(v.money !== undefined ? { money: v.money } : {}) };
        }),
        series: series.map((s) => ({
          key: s, name: SERIES_NAMES[s][lang], unit: s === "net_profit" ? "money" as const : "count" as const,
          points: daily.map((p) => ({ day: p.day, value: s === "orders" ? String(p.orders) : fromMinor(p.net, base).amount })),
        })),
      };
    });
  }

  /** The dashboard as a file: its tiles, then its daily series, labelled in the reader's language. */
  async export(auth: AuthContext, id: string, q: DashboardQuery, format: "csv" | "xlsx"): Promise<{ filename: string; type: string; body: Buffer }> {
    const d = await this.get(auth, id, q);
    const ar = auth.user.language === "ar";
    const L = ar
      ? { metric: "المقياس", value: "القيمة", unit: "الوحدة", definition: "التعريف", day: "اليوم", period: "الفترة", units: { count: "عدد", percent: "٪", money: d.currency, days: "يوم", multiple: "ضعف" } }
      : { metric: "Metric", value: "Value", unit: "Unit", definition: "Definition", day: "Day", period: "Period", units: { count: "count", percent: "%", money: d.currency, days: "days", multiple: "×" } };
    const num = (v: string | null): Cell => (v === null ? null : format === "xlsx" ? Number(v) : v);
    const rows: Cell[][] = [
      [d.name, `${L.period}: ${d.from} → ${d.to}`],
      [],
      [L.metric, L.value, L.unit, L.definition],
      ...d.tiles.map((t) => [t.name, num(t.value), L.units[t.unit], t.definition] as Cell[]),
    ];
    if (d.series.length) {
      rows.push([], [L.day, ...d.series.map((s) => s.name)]);
      for (let i = 0; i < d.series[0]!.points.length; i++) rows.push([d.series[0]!.points[i]!.day, ...d.series.map((s) => num(s.points[i]!.value))]);
    }
    const name = `mizan-${d.id}-${d.from}-${d.to}`;
    return format === "csv"
      ? { filename: `${name}.csv`, type: "text/csv; charset=utf-8", body: Buffer.from(csv(rows), "utf8") }
      : { filename: `${name}.xlsx`, type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", body: Buffer.from(xlsx(d.name, rows, { rtl: ar })) };
  }
}
