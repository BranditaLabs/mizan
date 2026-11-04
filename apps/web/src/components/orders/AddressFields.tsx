"use client";

import { findRegion, parseLocation, regionsOf, type Region } from "@mizan/shared";
import { Icon } from "@mizan/design-system/icons/react";
import { useLocale, useTranslations } from "next-intl";
import { useId } from "react";
import { Bdi } from "@/components/Bdi";
import { Button } from "@/components/ui/Button";
import { Field, Select } from "@/components/ui/Field";

/**
 * A delivery address the courier can find (manual orders, order edits). The governorate first, from
 * the list: it is what the courier books by, so a district typed as the city ("Sheraton") never
 * fails the booking again. Then the area (suggested for that governorate, free text allowed), the
 * street and building, a landmark, and the map pin if the customer shared one (a Google Maps link
 * or coordinates). A line at the end shows the address as the courier will read it.
 */
export interface AddressValue { province: string; city: string; line1: string; line2: string; locationText: string }

export const emptyAddress = (): AddressValue => ({ province: "", city: "", line1: "", line2: "", locationText: "" });

export type AddressErrors = Partial<Record<"province" | "city" | "line1" | "location", string>>;

/** What is missing or wrong, in the reader's words (keys of the `address` messages). */
export function addressProblems(v: AddressValue, country: string): Partial<Record<keyof AddressErrors, "province" | "city" | "line1" | "location">> {
  const listed = regionsOf(country).length > 0;
  return {
    ...(listed && !v.province ? { province: "province" as const } : {}),
    ...(v.city.trim().length < 2 ? { city: "city" as const } : {}),
    ...(v.line1.trim().length < 3 ? { line1: "line1" as const } : {}),
    ...(v.locationText.trim() && !parseLocation(v.locationText) ? { location: "location" as const } : {}),
  };
}

/** The address as the API takes it. */
export function addressBody(v: AddressValue) {
  const location = parseLocation(v.locationText);
  return {
    line1: v.line1.trim(), city: v.city.trim(),
    ...(v.line2.trim() ? { line2: v.line2.trim() } : {}),
    ...(v.province.trim() ? { province: v.province.trim() } : {}),
    ...(location ? { location } : {}),
  };
}

/** One line, the way a courier reads it. */
export function addressLine(v: { line1?: string | null; line2?: string | null; city?: string | null; province?: string | null }, sep: string): string {
  return [v.line1, v.line2, v.city, v.province].map((x) => x?.trim()).filter(Boolean).join(sep);
}

export function AddressFields({ value: v, onChange, country, showErrors }: {
  value: AddressValue; onChange(next: AddressValue): void; country: string; showErrors: boolean;
}) {
  const t = useTranslations("address");
  const locale = useLocale();
  const id = useId();
  const regions = regionsOf(country);
  const name = (r: Region) => (locale === "ar" ? r.ar : r.en);
  const region = regions.find((r) => r.en === v.province) ?? null;
  const problems = addressProblems(v, country);
  const err = (k: keyof AddressErrors) => (showErrors && problems[k] ? t(`errors.${problems[k]!}`) : undefined);
  const set = (next: Partial<AddressValue>) => onChange({ ...v, ...next });

  // An area that belongs to another governorate (or none chosen yet): say where it is, one tap to use it.
  const areaRegion = v.city.trim().length >= 3 ? findRegion(country, v.city) : null;
  const elsewhere = areaRegion && areaRegion.en !== v.province ? areaRegion : null;
  const pin = parseLocation(v.locationText);
  const coordinates = pin ? `${pin.lat}, ${pin.lng}` : "";
  const preview = addressLine({ ...v, province: region ? name(region) : v.province }, locale === "ar" ? "، " : ", ");

  return (
    <div className="grid gap-4 sm:grid-cols-2" data-testid="address-fields">
      {regions.length ? (
        <Select label={t("province")} value={v.province} error={err("province")} onChange={(e) => set({ province: e.target.value })}>
          <option value="" disabled>{t("choose")}</option>
          {regions.map((r) => <option key={r.code} value={r.en}>{name(r)}</option>)}
        </Select>
      ) : (
        <Field label={t("provinceFree")} value={v.province} onChange={(e) => set({ province: e.target.value })} />
      )}
      <div className="flex flex-col gap-1.5">
        <Field label={t("city")} hint={region ? t("cityHint") : undefined} value={v.city} list={`${id}-areas`} autoComplete="off"
          error={err("city")} onChange={(e) => set({ city: e.target.value })} />
        <datalist id={`${id}-areas`}>
          {(region ? region.areas : regions.flatMap((r) => r.areas)).map((x) => <option key={`${x.en}-${x.ar}`} value={locale === "ar" ? x.ar : x.en} />)}
        </datalist>
        {elsewhere ? (
          <p className="flex flex-wrap items-center gap-2 text-caption text-warning-text" role="status">
            {t(v.province ? "elsewhere" : "inRegion", { area: v.city.trim(), region: name(elsewhere) })}
            <Button size="sm" variant="ghost" onClick={() => set({ province: elsewhere.en })}>{t("useRegion", { region: name(elsewhere) })}</Button>
          </p>
        ) : null}
      </div>
      <Field label={t("line1")} hint={t("line1Hint")} className="sm:col-span-2" value={v.line1} error={err("line1")} onChange={(e) => set({ line1: e.target.value })} />
      <Field label={t("line2")} hint={t("line2Hint")} className="sm:col-span-2" value={v.line2} onChange={(e) => set({ line2: e.target.value })} />
      <div className="flex flex-col gap-1.5 sm:col-span-2">
        <Field label={t("location")} hint={t("locationHint")} ltr inputMode="url" value={v.locationText} error={err("location")} onChange={(e) => set({ locationText: e.target.value })} />
        {pin ? (
          <p className="flex flex-wrap items-center gap-2 text-caption text-success-text" data-testid="address-pin">
            <Icon name="pin" size={14} />{t("pinSet")} <Bdi code>{coordinates}</Bdi>
            <a className="underline" href={`https://www.google.com/maps?q=${pin.lat},${pin.lng}`} target="_blank" rel="noreferrer noopener">{t("openMap")}</a>
          </p>
        ) : null}
      </div>
      {preview ? (
        <div className="rounded-md border border-line bg-surface-sunk p-3 text-body-sm sm:col-span-2" data-testid="address-preview">
          <p className="text-caption text-text-3">{t("preview")}</p>
          <p><Bdi>{preview}</Bdi></p>
        </div>
      ) : null}
    </div>
  );
}
