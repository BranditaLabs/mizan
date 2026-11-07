import 'package:flutter/material.dart';
import 'package:lottie/lottie.dart';

import 'motion.dart';

/// The loader an event plays while it is on its way (the catalogue's `pending`): screens name the
/// event, never the loader. `fill` has a live value, so it is a [FillBar], not a loader.
class EventLoader extends StatelessWidget {
  const EventLoader(this.type, {super.key, this.height = 24, this.label, this.mono = true});

  final String type;
  final double height;

  /// Read out by screen readers; null when the loader sits next to its own text (decorative).
  final String? label;

  /// Inside buttons, rows and toasts the red ball is ink: the view's one red stays with the content.
  final bool mono;

  @override
  Widget build(BuildContext context) {
    final kind = motionOf(type).pending;
    if (kind == null || kind == MotionPending.fill) throw ArgumentError.value(type, 'type', 'has no loader');
    return MizanLoader(kind, height: height, label: label, mono: mono);
  }
}

/// Brand 2.0 loaders by meaning: pair = loading (the default), transfer = syncing between two
/// systems, drop = saving or confirming. Lottie from the pack (assets/lottie), on paper or on ink
/// by the theme; [TickerMode] pauses it on hidden routes and tabs. Under reduced motion it is a
/// deliberate still frame (pair level and apart, transfer balanced, drop at rest), never a slower loop.
class MizanLoader extends StatelessWidget {
  const MizanLoader(this.kind, {super.key, this.height = 24, this.label, this.mono = false})
      : assert(kind != MotionPending.fill, 'fill is FillBar');

  final MotionPending kind;
  final double height;
  final String? label;
  final bool mono;

  /// The pack's canvas (width / height), the same as the web loaders' view boxes.
  static const aspect = <MotionPending, double>{MotionPending.pair: 120 / 72, MotionPending.transfer: 120 / 60, MotionPending.drop: 120 / 84};

  static String asset(MotionPending kind, {required bool dark}) => 'assets/lottie/mizan-${kind.name}-on-${dark ? 'ink' : 'paper'}.json';

  @override
  Widget build(BuildContext context) {
    final colors = MotionColors.of(context);
    final width = height * aspect[kind]!;
    final reduced = reducedMotion(context);
    final still = CustomPaint(size: Size(width, height), painter: LoaderStillPainter(kind, colors, mono: mono));
    Widget art = reduced
        ? still
        : Lottie.asset(asset(kind, dark: colors.dark), width: width, height: height, fit: BoxFit.contain, repeat: true, errorBuilder: (_, _, _) => still);
    // The files carry the brand red; a mono loader draws every shape in the text colour.
    if (mono && !reduced) art = ColorFiltered(colorFilter: ColorFilter.mode(colors.ink, BlendMode.srcIn), child: art);
    final box = SizedBox(key: ValueKey('loader-${kind.name}'), width: width, height: height, child: art);
    return label == null ? ExcludeSemantics(child: box) : Semantics(label: label, liveRegion: true, child: box);
  }
}

/// The still frame of each loader (the same frames as the web's reduced motion), in the pack's
/// view-box units scaled to the size.
class LoaderStillPainter extends CustomPainter {
  LoaderStillPainter(this.kind, this.colors, {this.mono = false});

  final MotionPending kind;
  final MotionColors colors;
  final bool mono;

  @override
  void paint(Canvas canvas, Size size) {
    final (vw, vh) = switch (kind) { MotionPending.pair => (120.0, 72.0), MotionPending.transfer => (120.0, 60.0), _ => (120.0, 84.0) };
    final k = size.width / vw < size.height / vh ? size.width / vw : size.height / vh;
    canvas.translate((size.width - vw * k) / 2, (size.height - vh * k) / 2);
    canvas.scale(k);
    final ink = Paint()..color = colors.ink..isAntiAlias = true;
    final red = Paint()..color = mono ? colors.ink : colors.red..isAntiAlias = true;
    switch (kind) {
      case MotionPending.pair:
        // Two balls level and apart, as in the mark: ink left, red right.
        canvas.drawCircle(const Offset(39, 36), 10.5, ink);
        canvas.drawCircle(const Offset(81, 36), 10.5, red);
      case MotionPending.transfer:
        // Equal volumes, no droplets, the pivot balanced.
        canvas.drawLine(const Offset(34, 30), const Offset(86, 30), Paint()..color = colors.ink..strokeWidth = 3.4..strokeCap = StrokeCap.round);
        canvas.drawCircle(const Offset(34, 30), 12.47, ink);
        canvas.drawCircle(const Offset(86, 30), 12.47, ink);
        canvas.drawOval(Rect.fromCenter(center: const Offset(60, 30), width: 11.6, height: 8.2), red);
      case MotionPending.drop || MotionPending.fill:
        // The drop resting on a flat surface.
        canvas.drawRRect(RRect.fromRectAndRadius(const Rect.fromLTWH(8, 57.4, 104, 16.6), const Radius.circular(6)), ink);
        canvas.drawOval(Rect.fromCenter(center: const Offset(60, 68), width: 13.6, height: 8), red);
    }
  }

  @override
  bool shouldRepaint(LoaderStillPainter old) => old.kind != kind || old.colors != colors || old.mono != mono;
}
