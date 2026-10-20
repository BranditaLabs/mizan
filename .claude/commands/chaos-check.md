---
description: Run the engine's chaos suite and a seed sweep, and explain any failure
---

1. Run `npm test -w @mizan/engine`.
2. Run a sweep of 30 random seeds at 50% failure using the pattern in `packages/engine/test/e2e.chaos.test.ts` (set the seed through an env var if the test supports it; otherwise add that support first).
3. For every failure: name the invariant broken (duplicate delivery, duplicate fulfilment, missing payment mark, stuck job, dead letter), the seed, and the root cause in the code. Fix it with a regression test.
4. Report the pass rate and any fixes made.
