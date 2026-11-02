"use client";

import { useTranslations } from "next-intl";
import { Bdi } from "@/components/Bdi";
import { Badge, Tag } from "@/components/ui/Badge";
import { Card, KeyValue } from "@/components/ui/Surface";
import { DateText } from "@/components/ui/Values";
import { PlatformName } from "@/components/profit/PlatformName";
import type { Schemas } from "@/lib/api/client";

type Source = NonNullable<Schemas["OrderDetail"]["source"]>;

/**
 * Where this order came from (M7-2): the platform, paid or organic, the evidence that decided
 * (an ad click, UTM tags, the referring site…), the campaign tags, the first touch when it was
 * different, and discount codes. The click id itself is never shown, only its kind.
 */
export function SourceCard({ source }: { source: Source | null }) {
  const t = useTranslations("sources.card");
  if (!source || source.platform === "unknown") {
    return <Card title={t("title")}><p className="text-body-sm text-text-2">{t("unknown")}</p></Card>;
  }
  const utm = source.utm;
  const items = [
    { label: t("rule"), value: t(`rules.${source.rule}`) },
    ...(utm.campaign ? [{ label: t("campaign"), value: <Bdi>{utm.campaign}</Bdi> }] : []),
    ...(utm.content ? [{ label: t("ad"), value: <Bdi>{utm.content}</Bdi> }] : []),
    ...(utm.source || utm.medium ? [{ label: t("tags"), value: <Bdi code>{[utm.source, utm.medium].filter(Boolean).join(" / ")}</Bdi> }] : []),
    ...(source.referrerDomain ? [{ label: t("referrer"), value: <Bdi code>{source.referrerDomain}</Bdi> }] : []),
    ...(source.landingPath ? [{ label: t("landing"), value: <Bdi code>{source.landingPath}</Bdi> }] : []),
    ...(source.firstPlatform ? [{ label: t("first"), value: <span><PlatformName platform={source.firstPlatform} />{source.firstSeenAt ? <span className="text-text-3">{" · "}<DateText value={source.firstSeenAt} /></span> : null}</span> }] : []),
  ];
  return (
    <Card title={t("title")}>
      <div className="flex flex-col gap-3" data-testid="order-source">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-body font-semibold"><PlatformName platform={source.platform} /></span>
          {source.paid === true ? <Badge tone="info">{t("paid")}</Badge> : source.paid === false ? <Badge tone="neutral">{t("organic")}</Badge> : null}
          {source.clickIdKind ? <Tag icon="link"><Bdi code>{source.clickIdKind}</Bdi></Tag> : null}
        </div>
        <KeyValue items={items} />
        {source.discountCodes.length ? (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-caption text-text-2">{t("codes")}</span>
            {source.discountCodes.map((c) => <Tag key={c}><Bdi code>{c}</Bdi></Tag>)}
          </div>
        ) : null}
      </div>
    </Card>
  );
}
