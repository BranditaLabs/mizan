import 'dart:math' as math;

import 'package:flutter/material.dart';

import '../theme/mizan_tokens.dart';
import 'motion.dart';

/// A small two-ball glyph that plays one outcome once (the web's EventGlyph, same geometry):
/// settle rises with overshoot; done settles, merges and draws a check; merge forms the neck; tip
/// tilts and holds at angle.tipHold; fail tips twice, damps out and rests in the danger tone; drop
/// lets the red fall once and ripple, the only outcome that uses red. Under reduced motion it shows
/// the end frame at once, and so does a [still] glyph (a past answer on a list row: it never
/// replays on mount). Rebuild it with a new key to play again.
class EventGlyph extends StatefulWidget {
  const EventGlyph(this.outcome, {super.key, this.size = 20, this.label, this.still = false});

  final MotionOutcome outcome;
  final double size;

  /// The end frame only, no playback: for a record of something that already happened.
  final bool still;

  /// Read out only when the glyph stands alone; next to its copy it is decorative.
  final String? label;

  @override
  State<EventGlyph> createState() => _EventGlyphState();

  /// How long each outcome plays (motion tokens).
  static Duration durationOf(MotionOutcome o) => switch (o) {
        MotionOutcome.merge => MizanMotion.merge,
        MotionOutcome.drop => MizanMotion.fall + MizanMotion.ripple,
        MotionOutcome.done => MizanMotion.settle + MizanMotion.merge,
        MotionOutcome.quiet => Duration.zero,
        _ => MizanMotion.settle,
      };
}

class _EventGlyphState extends State<EventGlyph> with SingleTickerProviderStateMixin {
  late final AnimationController _c = AnimationController(vsync: this, duration: EventGlyph.durationOf(widget.outcome));
  bool _started = false;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (_started) return;
    _started = true;
    if (widget.still || reducedMotion(context) || widget.outcome == MotionOutcome.quiet) {
      _c.value = 1;
    } else {
      _c.forward();
    }
  }

  @override
  void dispose() {
    _c.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final colors = MotionColors.of(context);
    final danger = Theme.of(context).brightness == Brightness.dark ? MizanColorsDark.dangerText : MizanColorsLight.dangerText;
    final art = AnimatedBuilder(
      animation: _c,
      builder: (context, _) => CustomPaint(size: Size.square(widget.size), painter: EventGlyphPainter(widget.outcome, _c.value, colors, danger: danger, rtl: Directionality.of(context) == TextDirection.rtl)),
    );
    final box = SizedBox(key: ValueKey('glyph-${widget.outcome.name}'), width: widget.size, height: widget.size, child: art);
    return widget.label == null ? ExcludeSemantics(child: box) : Semantics(label: widget.label, image: true, child: box);
  }
}

/// The off-balance glyph for a blocked scan (TIP: it tilts and holds at angle.tipHold).
class TipGlyph extends StatelessWidget {
  const TipGlyph({super.key, this.size = 28, this.label});

  final double size;
  final String? label;

  @override
  Widget build(BuildContext context) => EventGlyph(MotionOutcome.tip, size: size, label: label);
}

/// One frame of a glyph at progress [t] (0..1) in a 24-unit box.
class EventGlyphPainter extends CustomPainter {
  EventGlyphPainter(this.outcome, this.t, this.colors, {required this.danger, this.rtl = false});

  final MotionOutcome outcome;
  final double t;
  final MotionColors colors;
  final Color danger;

  /// The heavier pan tips toward the line's end, so the tilt mirrors in Arabic.
  final bool rtl;

  static double _seg(double t, double from, double to) => ((t - from) / (to - from)).clamp(0.0, 1.0);

  @override
  void paint(Canvas canvas, Size size) {
    if (outcome == MotionOutcome.quiet) return;
    canvas.scale(size.width / 24);
    final ink = Paint()..color = outcome == MotionOutcome.fail ? danger : colors.ink..isAntiAlias = true;
    final total = EventGlyph.durationOf(outcome).inMicroseconds;
    double at(Duration d) => total == 0 ? 1 : d.inMicroseconds / total;

    double lift = 0, angle = 0, neck = 0;
    switch (outcome) {
      case MotionOutcome.settle:
        lift = 6 * (1 - MizanMotion.settleCurve.transform(t));
      case MotionOutcome.done:
        lift = 6 * (1 - MizanMotion.settleCurve.transform(_seg(t, 0, at(MizanMotion.settle))));
        neck = Curves.easeInOut.transform(_seg(t, at(MizanMotion.settle) * 0.6, at(MizanMotion.settle) * 0.6 + at(MizanMotion.merge)));
      case MotionOutcome.merge:
        neck = Curves.easeInOut.transform(t);
      case MotionOutcome.tip:
        // Up to angle.tip with the settle curve, then back to the held tilt.
        angle = t < 0.4
            ? MizanMotion.angleTip * Curves.easeOut.transform(t / 0.4)
            : MizanMotion.angleTipHold + (MizanMotion.angleTip - MizanMotion.angleTipHold) * (1 - MizanMotion.settleCurve.transform((t - 0.4) / 0.6));
      case MotionOutcome.fail:
        angle = 14 * math.sin(t * 4 * math.pi) * math.pow(1 - t, 2);
      default:
        break;
    }
    canvas.save();
    canvas.translate(12, 12 + lift);
    canvas.rotate((rtl ? -angle : angle) * math.pi / 180);
    canvas.translate(-12, -12);
    final drop = outcome == MotionOutcome.drop;
    canvas.drawCircle(const Offset(7.5, 12), 4.5, ink);
    if (drop) {
      // The red falls once from above and lands as the right pan, then the ripple dies out.
      final fall = _seg(t, 0, at(MizanMotion.fall));
      final y = -6 + 18 * Curves.easeIn.transform(fall);
      canvas.drawCircle(Offset(16.5, y), 4.5, Paint()..color = colors.red..isAntiAlias = true);
      final r = _seg(t, at(MizanMotion.fall), 1);
      if (r > 0 && r < 1) {
        canvas.drawCircle(const Offset(16.5, 12), 4.5 + 5 * r, Paint()..style = PaintingStyle.stroke..strokeWidth = 1..color = colors.red.withValues(alpha: 1 - r));
      }
    } else {
      canvas.drawCircle(const Offset(16.5, 12), 4.5, ink);
    }
    if (neck > 0) {
      // MERGE: the neck forms between the two balls until they read as one drop.
      canvas.drawRRect(RRect.fromRectAndRadius(Rect.fromCenter(center: const Offset(12, 12), width: 9, height: 9 * neck), Radius.circular(4.5 * neck)), ink);
    }
    if (outcome == MotionOutcome.done) {
      final draw = _seg(t, at(MizanMotion.settle) * 0.6 + at(MizanMotion.merge) * 0.5, 1);
      if (draw > 0) {
        final path = Path()..moveTo(8.4, 12.2)..lineTo(10.7, 14.5)..lineTo(15.6, 9.6);
        final metric = path.computeMetrics().first;
        canvas.drawPath(metric.extractPath(0, metric.length * draw), Paint()..style = PaintingStyle.stroke..strokeWidth = 1.8..strokeCap = StrokeCap.round..strokeJoin = StrokeJoin.round..color = colors.paper);
      }
    }
    canvas.restore();
  }

  @override
  bool shouldRepaint(EventGlyphPainter old) => old.t != t || old.outcome != outcome || old.colors != colors || old.rtl != rtl || old.danger != danger;
}
