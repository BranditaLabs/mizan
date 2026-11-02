"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { Button, ButtonGroup } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Field } from "@/components/ui/Field";
import { useToast } from "@/components/ui/Toast";
import { ok } from "@/lib/api/client";
import { useSession } from "@/lib/session";

const KEY = /^ck_[A-Za-z0-9_]{8,}$/;
const SECRET = /^cs_[A-Za-z0-9_]{8,}$/;

/**
 * E5-7: connect a WooCommerce store with REST keys (Read/Write) the owner creates in WooCommerce.
 * The keys are checked in the background (the store's webhooks are pointed at Mizan); the list
 * shows "Checking" until then, and why if the store refused them. Also used to paste new keys.
 */
export function WooCommerceConnect({ open, onClose, site = "" }: { open: boolean; onClose(): void; site?: string }) {
  const t = useTranslations("integrationsSettings.woo");
  const { api } = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const locale = useLocale() === "en" ? "en" : "ar";
  const [mode, setMode] = useState<"approve" | "keys">("approve");
  const [siteUrl, setSiteUrl] = useState(site);
  const [consumerKey, setKey] = useState("");
  const [consumerSecret, setSecret] = useState("");
  const save = useMutation({
    mutationFn: () => ok(api.POST("/v1/connections/woocommerce", { body: { siteUrl: siteUrl.trim(), consumerKey: consumerKey.trim(), consumerSecret: consumerSecret.trim() } })),
    onSuccess: () => {
      toast({ message: t("saved") });
      setKey("");
      setSecret("");
      void qc.invalidateQueries({ queryKey: ["connections"] });
      onClose();
    },
  });
  // One click: WooCommerce's own approval page; the keys come back to Mizan by themselves.
  const approve = useMutation({
    mutationFn: () => ok(api.POST("/v1/connections/woocommerce/authorize", { body: { siteUrl: siteUrl.trim(), locale } })),
    onSuccess: (r) => { window.location.assign(r.url); },
  });
  const keyBad = consumerKey.trim() !== "" && !KEY.test(consumerKey.trim());
  const secretBad = consumerSecret.trim() !== "" && !SECRET.test(consumerSecret.trim());
  const ready = siteUrl.trim().length > 3 && KEY.test(consumerKey.trim()) && SECRET.test(consumerSecret.trim());
  const siteOk = siteUrl.trim().length > 3;
  return (
    <Dialog open={open} onClose={onClose} title={t("title")} description={t(mode === "approve" ? "approveBody" : "body")} footer={(
      <ButtonGroup>
        {mode === "approve"
          ? <Button busy={approve.isPending} disabled={!siteOk} onClick={() => approve.mutate()}>{t("approve")}</Button>
          : <Button busy={save.isPending} disabled={!ready} onClick={() => save.mutate()}>{t("connect")}</Button>}
        <Button variant="ghost" onClick={onClose}>{t("cancel")}</Button>
      </ButtonGroup>
    )}>
      <div className="flex flex-col gap-3" data-testid="woo-connect">
        <Field label={t("site")} placeholder={t("sitePlaceholder")} value={siteUrl} onChange={(e) => setSiteUrl(e.target.value)} ltr inputMode="url" autoComplete="url" />
        {mode === "approve" ? (
          <>
            <p className="text-body-sm text-text-2">{t("approveHint")}</p>
            <Button variant="ghost" size="sm" className="self-start" onClick={() => setMode("keys")}>{t("useKeys")}</Button>
          </>
        ) : (
          <>
            <ol className="list-decimal ps-5 text-body-sm text-text-2">
              <li>{t("steps.one")}</li>
              <li>{t("steps.two")}</li>
              <li>{t("steps.three")}</li>
            </ol>
            <Field label={t("key")} value={consumerKey} onChange={(e) => setKey(e.target.value)} ltr autoComplete="off" spellCheck={false} error={keyBad ? t("keyInvalid") : null} />
            <Field label={t("secret")} type="password" value={consumerSecret} onChange={(e) => setSecret(e.target.value)} ltr autoComplete="off" spellCheck={false} error={secretBad ? t("secretInvalid") : null} hint={t("secretHint")} />
            <Button variant="ghost" size="sm" className="self-start" onClick={() => setMode("approve")}>{t("useApprove")}</Button>
          </>
        )}
      </div>
    </Dialog>
  );
}
