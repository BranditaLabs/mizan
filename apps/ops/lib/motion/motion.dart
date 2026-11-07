import 'package:flutter/material.dart';

import '../theme/mizan_tokens.dart';
import 'event_motion.g.dart';

export 'event_motion.g.dart';

/// The phone's own work (not domain events): what each plays. Screens name an event, never an
/// animation; the shared catalogue ([eventMotion], generated from packages/shared/src/motion) and
/// this list decide. A key here never shadows a domain event (test/motion_test.dart).
const Map<String, EventMotion> opsEventMotion = <String, EventMotion>{
  // The first frame, until the phone's database opens.
  'ops.booting': EventMotion(outcome: MotionOutcome.quiet, pending: MotionPending.pair, surfaces: <String>['card'], copy: null),
  // Refreshing pick lists or purchase orders from Mizan.
  'ops.loading': EventMotion(outcome: MotionOutcome.quiet, pending: MotionPending.pair, surfaces: <String>['list'], copy: null),
  // Sending the phone's queue to Mizan: two systems reconciling.
  'ops.syncing': EventMotion(outcome: MotionOutcome.merge, pending: MotionPending.transfer, surfaces: <String>['sync', 'list'], copy: null),
  'ops.sync_failed': EventMotion(outcome: MotionOutcome.fail, surfaces: <String>['toast'], copy: null),
  // One scan checked on the spot: counted, or blocked (a wrong item, more than wanted).
  'ops.scan_counted': EventMotion(outcome: MotionOutcome.settle, surfaces: <String>['card'], copy: null),
  'ops.scan_blocked': EventMotion(outcome: MotionOutcome.tip, surfaces: <String>['card'], copy: null),
};

/// The motion for an event type: the shared catalogue first, then the phone's own events.
EventMotion motionOf(String type) {
  final m = eventMotion[type] ?? opsEventMotion[type];
  if (m == null) throw ArgumentError.value(type, 'type', 'not in the event-motion catalogue');
  return m;
}

/// Reduced motion (the phone's "remove animations" setting): deliberate still frames, no loops.
bool reducedMotion(BuildContext context) => MediaQuery.maybeDisableAnimationsOf(context) ?? false;

/// A duration from the tokens, or its reduced entry under reduced motion.
Duration motionDuration(BuildContext context, Duration normal, Duration reduced) => reducedMotion(context) ? reduced : normal;

/// Brand colours for the painters: ink and paper swap with the theme; red is the one point
/// (red on ink is #E33232).
class MotionColors {
  const MotionColors({required this.ink, required this.paper, required this.red, required this.line, required this.dark});

  final Color ink;
  final Color paper;
  final Color red;
  final Color line;
  final bool dark;

  static const light = MotionColors(ink: MizanBrand.ink, paper: MizanBrand.paper, red: MizanBrand.red, line: MizanColorsLight.lineStrong, dark: false);
  static const onInk = MotionColors(ink: MizanBrand.paper, paper: MizanBrand.ink, red: MizanBrand.redHi, line: MizanColorsDark.lineStrong, dark: true);

  static MotionColors of(BuildContext context) => Theme.of(context).brightness == Brightness.dark ? onInk : light;
}
