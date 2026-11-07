import 'dart:math' as math;
import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:flutter/physics.dart';

import '../theme/mizan_tokens.dart';
import 'motion.dart';

/// A spring toward a target on one [AnimationController]; it stops when it rests, so a still
/// screen draws no frames. Reduced motion snaps to the target.
mixin SpringValue<T extends StatefulWidget> on State<T>, SingleTickerProviderStateMixin<T> {
  late final AnimationController spring = AnimationController.unbounded(vsync: this);

  SpringDescription get springDescription;

  void springTo(double target, {bool snap = false}) {
    if (snap || reducedMotion(context)) {
      spring.value = target;
      return;
    }
    if ((spring.value - target).abs() < 1e-4 && !spring.isAnimating) return;
    spring.animateWith(SpringSimulation(springDescription, spring.value, target, spring.velocity));
  }

  @override
  void dispose() {
    spring.dispose();
    super.dispose();
  }
}

/// The goo filter of the Brand 2.0 loaders: a blur, then a steep alpha curve that joins blobs.
Widget goo(Widget child, {required double blur, required double a, required double b}) => ColorFiltered(
      colorFilter: ColorFilter.matrix(<double>[1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, a, b * 255]),
      child: ImageFiltered(imageFilter: ui.ImageFilter.blur(sigmaX: blur, sigmaY: blur, tileMode: TileMode.decal), child: child),
    );

/// FILL, known progress (scanned of wanted, imports, payouts): liquid fills the track from the
/// line's start and the red bubble rides the front; at the end the bubble leaves and fades. A new
/// value flows from the current one (smoothing spring.fill). Reduced motion: the width at once,
/// with the percentage as text.
class FillBar extends StatefulWidget {
  const FillBar({super.key, required this.done, required this.total, this.label, this.mono = false, this.height = 14});

  final int done;
  final int total;

  /// Read out with the value; null when the bar sits next to its own text.
  final String? label;

  /// Rows and lists: the bubble is ink, so the view's one red stays with its main bar.
  final bool mono;
  final double height;

  double get value => total <= 0 ? 0 : (done / total).clamp(0.0, 1.0);

  @override
  State<FillBar> createState() => _FillBarState();
}

class _FillBarState extends State<FillBar> with SingleTickerProviderStateMixin, SpringValue {
  // spring.fill.smoothing as a critically damped spring (k = s², ratio 1).
  @override
  SpringDescription get springDescription => SpringDescription.withDampingRatio(mass: 1, stiffness: MizanMotion.springFillSmoothing * MizanMotion.springFillSmoothing, ratio: 1);

  bool _first = true;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (_first) {
      _first = false;
      springTo(widget.value, snap: true);
    }
  }

  @override
  void didUpdateWidget(FillBar old) {
    super.didUpdateWidget(old);
    if (old.value != widget.value) springTo(widget.value);
  }

  @override
  Widget build(BuildContext context) {
    final colors = MotionColors.of(context);
    final reduced = reducedMotion(context);
    final pct = (widget.value * 100).round();
    final bar = LayoutBuilder(builder: (context, box) {
      final w = box.maxWidth.isFinite ? box.maxWidth : 240.0;
      return AnimatedBuilder(
        animation: spring,
        builder: (context, _) {
          final v = spring.value.clamp(0.0, 1.0);
          final rtl = Directionality.of(context) == TextDirection.rtl;
          return SizedBox(
            width: w, height: widget.height,
            child: Stack(children: [
              Positioned.fill(child: DecoratedBox(decoration: BoxDecoration(color: colors.ink.withValues(alpha: 0.14), borderRadius: BorderRadius.circular(widget.height / 2)))),
              Positioned.fill(
                child: ClipRRect(
                  borderRadius: BorderRadius.circular(widget.height / 2),
                  child: CustomPaint(painter: FillPainter(v, colors, mono: widget.mono, rtl: rtl, reduced: reduced)),
                ),
              ),
            ]),
          );
        },
      );
    });
    return Semantics(
      label: widget.label,
      value: '$pct%',
      child: ExcludeSemantics(
        child: reduced
            ? Row(children: [Expanded(child: bar), const SizedBox(width: MizanSpace.s2), Text('\u2066$pct%\u2069', style: MizanType.mono)])
            : bar,
      ),
    );
  }
}

/// The liquid and its bubble at value [v]; drawn left to right and mirrored for Arabic.
class FillPainter extends CustomPainter {
  FillPainter(this.v, this.colors, {this.mono = false, this.rtl = false, this.reduced = false});

  final double v;
  final MotionColors colors;
  final bool mono;
  final bool rtl;
  final bool reduced;

  @override
  void paint(Canvas canvas, Size size) {
    if (rtl) {
      canvas.translate(size.width, 0);
      canvas.scale(-1, 1);
    }
    final h = size.height;
    final front = size.width * v;
    final liquid = Paint()..color = colors.ink..isAntiAlias = true;
    if (front > 0) {
      canvas.drawRRect(RRect.fromRectAndRadius(Rect.fromLTWH(0, 0, front, h), Radius.circular(h / 2)), liquid);
    }
    // The bubble rides just behind the front; at the end it rides out past the track and fades.
    final done = ((v - 0.985) / 0.015).clamp(0.0, 1.0);
    final on = v > 0.04 && (v < 0.999 || reduced) ? 1.0 - done : 0.0;
    if (on > 0 && !(reduced && v >= 0.999)) {
      final cx = math.max(h * 0.75, front - h * 0.6 + h * 2 * done);
      canvas.drawOval(Rect.fromCenter(center: Offset(cx, h / 2), width: h * 0.56, height: h * 0.4), Paint()..color = (mono ? colors.paper : colors.red).withValues(alpha: on));
    }
  }

  @override
  bool shouldRepaint(FillPainter old) => old.v != v || old.colors != colors || old.mono != mono || old.rtl != rtl || old.reduced != reduced;
}
