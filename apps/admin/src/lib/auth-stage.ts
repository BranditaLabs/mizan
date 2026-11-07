/**
 * What the staff sign-in card tells the staff stage (StaffFrame), the back office's side of the
 * dashboard's authUi.signal: an error tips the mark (TIP, then level), signed in hands the red to
 * the card's DoneState. The staff stage has no map, so sending moves nothing. No PII.
 */
export type StaffStageSignal = "error" | "signedIn";
const listeners = new Set<(s: StaffStageSignal) => void>();

export const staffStage = {
  signal(s: StaffStageSignal) { listeners.forEach((l) => l(s)); },
  onSignal(l: (s: StaffStageSignal) => void) { listeners.add(l); return () => { listeners.delete(l); }; },
};
