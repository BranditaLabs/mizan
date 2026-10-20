---
description: Audit web and ops app code for i18n and RTL problems
---

Check `apps/web` and `apps/ops` for:
1. Hard-coded user-facing strings (must come from `messages/*.json` or ARB files).
2. Keys present in `ar.json` but missing in `en.json`, or the reverse.
3. Physical direction utilities or styles (`ml-`, `mr-`, `pl-`, `pr-`, `left-`, `right-`, `text-left`, `margin-left` …) — replace with logical ones.
4. Numbers, phones, order IDs, SKUs and URLs inside Arabic text not wrapped in `<bdi>`.
5. Direction-implying icons that do not flip in RTL.
6. Money and dates not formatted through `Intl` with the tenant locale.

List findings by file and line, fix the safe ones, and ask before changing copy wording.
