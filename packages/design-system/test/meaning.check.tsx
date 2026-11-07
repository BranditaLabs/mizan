/**
 * Type-level guards for the motion meanings (checked by `npm run typecheck`, not run by vitest):
 * a busy key names what the press does, and FILL is never indeterminate.
 */
import { PrimaryCta } from "../react/auth";
import { MizanLoader } from "../react/motion";

declare const pending: boolean;

export const typeChecks = [
  <PrimaryCta key="idle" label="Continue" />,
  <PrimaryCta key="ok" label="Continue" busy={pending} busyAs="signingIn" />,
  // @ts-expect-error -- a busy key with no meaning would fall back to an animation by accident
  <PrimaryCta key="bad" label="Continue" busy={pending} />,
  // @ts-expect-error -- "drop" is an animation, not a meaning
  <PrimaryCta key="anim" label="Continue" busy={pending} busyAs="drop" />,
  <MizanLoader key="f" kind="fill" value={0.3} valueText="30%" decorative />,
  // @ts-expect-error -- fill is known progress: it needs a real value
  <MizanLoader key="fx" kind="fill" decorative />,
  // @ts-expect-error -- a wait with no value is pair, transfer or drop, never an indeterminate fill
  <MizanLoader key="fy" kind="fill" value={undefined} valueText="" decorative />,
];
