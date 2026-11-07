/**
 * Type-level guards (checked by `npm run typecheck`, not run by vitest): a busy control names what
 * the press does (a meaning or an event with an action), never an animation and never a default.
 */
import { Button, IconButton } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/Dialog";
import { Switch } from "@/components/ui/Choice";
import type { EventMutation } from "@/lib/motion/useEventMutation";

declare const pending: boolean;
declare const confirm: EventMutation<unknown, void, "order.confirmed">;
declare const fromOutside: EventMutation<unknown, void, "shipment.delivered">;
const noop = () => undefined;

export const checks = [
  <Button key="idle">x</Button>,
  <Button key="meaning" busy={pending} as="loading">x</Button>,
  <Button key="event" busy={confirm}>x</Button>,
  <Button key="event-as" busy={fromOutside} as="syncing">x</Button>,
  // @ts-expect-error -- a bare busy names no meaning: it would fall back to the save animation
  <Button key="bare" busy={pending}>x</Button>,
  // @ts-expect-error -- busy with no value is still a bare busy
  <Button key="true" busy>x</Button>,
  // @ts-expect-error -- an event with no action (it comes from outside) has no loader of its own
  <Button key="outside" busy={fromOutside}>x</Button>,
  // @ts-expect-error -- screens name a meaning, never a loader
  <Button key="pending" busy={pending} as="saving" pending="drop">x</Button>,
  // @ts-expect-error -- "fill" is not a meaning: measured progress is FillProgress with a value
  <Button key="fill" busy={pending} as="fill">x</Button>,
  // @ts-expect-error -- IconButton too
  <IconButton key="icon" icon="delete" label="x" busy={pending} />,
  // @ts-expect-error -- ConfirmDialog too
  <ConfirmDialog key="dialog" open onClose={noop} onConfirm={noop} title="t" description="d" confirmLabel="c" busy={pending} />,
  <ConfirmDialog key="dialog-ok" open onClose={noop} onConfirm={noop} title="t" description="d" confirmLabel="c" busy={pending} as="saving" />,
  // @ts-expect-error -- a switch that writes names its meaning
  <Switch key="switch" label="x" busy={pending} />,
];
