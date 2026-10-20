# @mizan/shared

Code every Mizan package agrees on. Imported as `@mizan/shared` (npm workspace, TypeScript source).

| File | What |
| --- | --- |
| `src/model.ts` | Canonical model: `CanonicalOrder`, `CanonicalProduct`, `CanonicalShipment`, `Money`, payment modes/statuses, shipment lifecycle. Connectors map providers to these; business code never sees provider payloads. |
| `src/money.ts` | Exact money. `toMinor("1150.50", "EGP") → 115050n`, `fromMinor(12345n, "KWD") → "12.345"`, ISO 4217 decimals table (0/2/3/4), `addMoney`, `subtractMoney`, `sumMoney`, `compareMoney`. Bigint and strings only; never rounds. |
| `src/phone.ts` | `normalizePhone(input, "EG" \| "SA" \| "AE")` → `{ e164, country, national }` for mobile numbers, from any shape customers type (spaces, `00`, `+`, trunk zero, Arabic-Indic digits, bidi marks). |
| `src/schemas.ts` | Zod schemas for every canonical type, checked against the interfaces with `satisfies`. Use at trust boundaries: API DTOs, job payloads, imports. |

```
npm test -w @mizan/shared        # with coverage; money.ts must stay at 100%
npm run typecheck -w @mizan/shared
```
