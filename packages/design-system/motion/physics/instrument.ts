/**
 * What the four balance instruments share: a "wobble" that a change kicks and that decays, and
 * ambient motion that is switched off under reduced motion. Geometry only: money arrives as decimal
 * strings and is compared exactly by the component; these functions see floats for drawing.
 */
export interface InstrumentBase { t: number; wob: number; kick: number }

export const base = (): InstrumentBase => ({ t: 0, wob: 0, kick: 0 });

/** Advance time and the wobble; returns whether ambient motion runs this frame. */
export function advance(S: InstrumentBase, dt: number, reduced: boolean): boolean {
  if (reduced) { S.wob = 0; S.kick = 0; return false; }
  S.t += dt;
  S.wob = Math.min(1.4, S.wob * Math.exp(-2.1 * dt) + S.kick * 0.9);
  S.kick = 0;
  return true;
}

/** A new reading: the instrument settles to it with a small impulse. */
export const kick = (S: InstrumentBase) => { S.kick = 1; };
