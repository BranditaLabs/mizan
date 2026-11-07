import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { GEOMETRY, lane } from "../src/components/auth/stage/geometry";
import { WAIT_MOTION } from "@mizan/shared/motion";
import { BEAT_MS, INTRO_MS, STAGE_WAIT, initialStage, markBeat, moving, stage, type StageEvent, type StageState } from "../src/components/auth/stage/machine";

const run = (events: StageEvent["type"][], reduced = false, from: StageState = initialStage(reduced)) =>
  events.reduce((s, type) => stage(s, { type } as StageEvent, reduced), from);

describe("the auth stage is part of the page: a short intro, then still, then it answers the form", () => {
  it("the intro is shorter than 5 seconds (WCAG 2.2.2: no pause control needed) and ends settled", () => {
    expect(INTRO_MS).toBeLessThanOrEqual(5000);
    expect(initialStage(false).phase).toBe("intro");
    expect(markBeat("intro")).toBe("settle");
    const s = run(["introEnd"]);
    expect(s.phase).toBe("settled");
    expect(moving(s.phase)).toBe(false);
    expect(markBeat(s.phase)).toBeNull();
  });

  it("settled stays settled: only the card's news moves it", () => {
    let s = run(["introEnd", "introEnd", "idle", "beatEnd"]);
    expect(s.phase).toBe("settled");
    s = stage(s, { type: "send" });
    expect(s.phase).toBe("transfer");
    expect(markBeat(s.phase)).toBeNull(); // the edges carry TRANSFER, the mark stays level
    expect(stage(s, { type: "idle" }).phase).toBe("settled");
  });

  it("a send is one bounded TRANSFER pass with the catalogue's meaning, then still even if the work goes on", () => {
    expect(STAGE_WAIT).toBe(WAIT_MOTION.sending);
    expect(STAGE_WAIT).toBe("transfer");
    expect(BEAT_MS.transfer).toBeLessThanOrEqual(5000);
    const s = run(["introEnd", "send"]);
    expect(stage(s, { type: "beatEnd" }).phase).toBe("settled");
    // A second send while the pass runs does not restart it; after it, a new send passes again.
    expect(stage(s, { type: "send" })).toEqual(s);
    const again = run(["beatEnd", "send"], false, s);
    expect(again.phase).toBe("transfer");
    expect(again.seq).toBeGreaterThan(s.seq);
  });

  it("an error tips the mark, a second one tips it again, and it settles after the beat", () => {
    const one = run(["introEnd", "send", "error"]);
    expect(one.phase).toBe("tip");
    expect(markBeat(one.phase)).toBe("tip");
    const two = stage(one, { type: "error" });
    expect(two.phase).toBe("tip");
    expect(two.seq).toBeGreaterThan(one.seq); // a new key replays the beat
    expect(stage(two, { type: "beatEnd" }).phase).toBe("settled");
    expect(BEAT_MS.tip).toBeLessThanOrEqual(5000);
  });

  it("the card can speak during the intro: it ends the intro", () => {
    expect(run(["send"]).phase).toBe("transfer");
    expect(run(["error"]).phase).toBe("tip");
  });

  it("signed in: the stage settles and stays still (the card's DoneState owns the one red DROP)", () => {
    const s = run(["introEnd", "send", "signedIn"]);
    expect(s.phase).toBe("settled");
    expect(s.signedIn).toBe(true);
    expect(markBeat(s.phase)).toBeNull();
    const after = run(["beatEnd", "error", "send", "signedIn"], false, s);
    expect(after).toEqual(s);
    expect(run(["signedIn"]).phase).toBe("settled"); // even during the intro
  });

  it("reduced motion: no intro and no beats, the settled frame throughout", () => {
    expect(initialStage(true).phase).toBe("settled");
    for (const e of ["send", "error", "signedIn", "idle", "beatEnd"] as const) expect(run([e], true).phase).toBe("settled");
    // A preference turned on mid-intro settles at once.
    expect(stage(initialStage(false), { type: "introEnd" }, true).phase).toBe("settled");
  });
});

describe("no pause control is left", () => {
  const read = (p: string) => readFileSync(join(__dirname, "..", p), "utf8");
  it("the stage has no pause or play button, and the copy has no pause or play strings", () => {
    const src = read("src/components/auth/stage/AuthStage.tsx");
    expect(src).not.toMatch(/stage-pause|mz-auth-pause|togglePause|localStorage/);
    for (const l of ["ar", "en"]) {
      const stageCopy = JSON.parse(read(`messages/${l}.json`)).authStage as Record<string, unknown>;
      expect(stageCopy.pause).toBeUndefined();
      expect(stageCopy.play).toBeUndefined();
    }
    expect(readFileSync(join(__dirname, "../../../packages/design-system/css/auth.css"), "utf8")).not.toContain("mz-auth-pause");
  });
  it("the animator has no loop at all: the intro plays once, each send is one pass", () => {
    const src = read("src/components/auth/stage/animator.ts");
    expect(src).not.toMatch(/Infinity|iterations/);
    expect(src).not.toContain("drift");
  });
  it("a late animator is brought to the current phase, and the intro is timed from mount", () => {
    const src = read("src/components/auth/stage/AuthStage.tsx");
    expect(src).toMatch(/buildStage\(root\.current, \{ elapsed: performance\.now\(\) - mountedAt\.current/);
    expect(src).toMatch(/if \(at !== "intro"\) c\.finishIntro\(\)/);
    expect(src).toMatch(/c\.transfer\(at === "transfer" && seen\)/);
  });
  it("the stage's mark lets the red go once signed in and while the stage is hidden", () => {
    const src = read("src/components/auth/stage/AuthStage.tsx");
    expect(src).toMatch(/markRed = scene !== "outage" && !hidden && !st\.signedIn/);
    expect(src).not.toMatch(/"drop"/);
  });
});

describe("the band's lanes never braid", () => {
  it("lanes from the top row bow up, from the bottom row down, and a level one runs straight", () => {
    const g = GEOMETRY.band;
    for (const n of g.nodes) {
      const { c, from, to } = lane(g, n);
      const mid = (from.y + to.y) / 2;
      if (n.y < g.hub.y) expect(c.y).toBeLessThanOrEqual(mid); else if (n.y > g.hub.y) expect(c.y).toBeGreaterThanOrEqual(mid); else expect(c.y).toBeCloseTo(mid);
      expect(c.y).toBeGreaterThanOrEqual(0);
      expect(c.y).toBeLessThanOrEqual(g.h);
    }
  });
  it("no two pills overlap and every pill sits inside the map", () => {
    const g = GEOMETRY.band;
    const box = (n: (typeof g.nodes)[number]) => ({ l: n.x - n.w / 2, r: n.x + n.w / 2, t: n.y - n.h / 2, b: n.y + n.h / 2 });
    g.nodes.forEach((a, i) => {
      const A = box(a);
      expect(A.l).toBeGreaterThanOrEqual(0); expect(A.r).toBeLessThanOrEqual(g.w); expect(A.t).toBeGreaterThanOrEqual(0); expect(A.b).toBeLessThanOrEqual(g.h);
      g.nodes.slice(i + 1).forEach((b) => { const B = box(b); expect(A.r <= B.l || B.r <= A.l || A.b <= B.t || B.b <= A.t).toBe(true); });
    });
  });
});
