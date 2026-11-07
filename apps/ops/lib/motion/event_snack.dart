import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../theme/mizan_tokens.dart';
import 'event_glyph.dart';
import 'motion.dart';

/// The haptic each outcome gives (a heavy buzz for a blocked or failed action, a light tap for a
/// finished one, a tick for the rest; nothing for a quiet event).
Future<void> hapticFor(MotionOutcome outcome) => switch (outcome) {
      MotionOutcome.tip || MotionOutcome.fail => HapticFeedback.heavyImpact(),
      MotionOutcome.done || MotionOutcome.drop => HapticFeedback.lightImpact(),
      MotionOutcome.settle || MotionOutcome.merge => HapticFeedback.selectionClick(),
      MotionOutcome.quiet => Future<void>.value(),
    };

/// A toast for an event: its glyph plays the catalogue's outcome next to [message], with the
/// outcome's haptic. Screens name the event type and the words; the catalogue picks the motion.
/// [variant] is the ICU select branch for an event whose outcome depends on it (never PII).
void showEventSnack(BuildContext context, String type, String message, {String? variant}) {
  final outcome = motionOf(type).outcomeFor(variant);
  hapticFor(outcome);
  ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: EventSnackContent(type: type, outcome: outcome, message: message)));
}

/// The toast's content: the glyph, then the words (start-aligned in both directions).
class EventSnackContent extends StatelessWidget {
  const EventSnackContent({super.key, required this.type, required this.outcome, required this.message});

  final String type;
  final MotionOutcome outcome;
  final String message;

  @override
  Widget build(BuildContext context) => Row(
        key: ValueKey('event-snack-$type'),
        children: [
          // The toast sits on ink in the light theme and on paper in the dark one: the glyph flips too.
          if (outcome != MotionOutcome.quiet)
            Padding(
              padding: const EdgeInsetsDirectional.only(end: MizanSpace.s3),
              child: Theme(data: Theme.of(context).brightness == Brightness.dark ? mizanLightTheme : mizanDarkTheme, child: EventGlyph(outcome)),
            ),
          Expanded(child: Text(message)),
        ],
      );
}
