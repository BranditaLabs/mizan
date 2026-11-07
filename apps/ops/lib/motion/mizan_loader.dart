import 'package:flutter/material.dart';
import 'package:lottie/lottie.dart';

import 'motion.dart';

/// The loader an event plays while it is on its way (the catalogue's `pending`): screens name the
/// event, never the loader. `fill` has a live value, so it is a [FillBar], not a loader.
class EventLoader extends StatelessWidget {
  const EventLoader(this.type, {super.key, this.height = 24, this.label, this.mono = true, this.still = false});

  final String type;
  final double height;

  /// Read out by screen readers; null when the loader sits next to its own text (decorative).
  final String? label;

  /// Inside buttons, rows and toasts the red ball is ink: the view's one red stays with the content.
  final bool mono;

  /// A list row: the still frame, no Lottie and no layer (one animated loader per view, on its control).
  final bool still;

  @override
  Widget build(BuildContext context) {
    final kind = motionOf(type).pending;
    if (kind == null || kind == MotionPending.fill) throw ArgumentError.value(type, 'type', 'has no loader');
    return MizanLoader(kind, height: height, label: label, mono: mono, still: still);
  }
}

/// Brand 2.0 loaders by meaning: pair = loading (the default), transfer = syncing between two
/// systems, drop = saving or confirming. Lottie from the pack (assets/lottie, the on-paper files
/// only: on ink the same file is recoloured by [onInkFilter], which keeps the bundle in its 1.2 MB
/// budget); [TickerMode] pauses it on hidden routes and tabs. Until the composition is parsed, and
/// under reduced motion, it is the deliberate still frame (pair: the merged mark at level; transfer
/// balanced; drop at rest), never a blank frame and never a slower loop.
class MizanLoader extends StatelessWidget {
  const MizanLoader(this.kind, {super.key, this.height = 24, this.label, this.mono = false, this.still = false})
      : assert(kind != MotionPending.fill, 'fill is FillBar');

  final MotionPending kind;
  final double height;
  final String? label;
  final bool mono;

  /// The still frame always (a list row).
  final bool still;

  /// The pack's canvas (width / height), the same as the web loaders' view boxes.
  static const aspect = <MotionPending, double>{MotionPending.pair: 120 / 72, MotionPending.transfer: 120 / 60, MotionPending.drop: 120 / 84};

  /// The pack file for a kind (on paper; the theme recolours it on ink).
  static String asset(MotionPending kind) => 'assets/lottie/mizan-${kind.name}-on-paper.json';

  /// The on-paper files hold exactly two colours, ink #0B0B0B and red #DE0000 (the gradient fills
  /// are hard two-stop). A colour matrix on the red channel maps them onto [to]'s ink and red, which
  /// is what the pack's -on-ink files carry (paper #FEF7FF and red #E33232).
  static ColorFilter onInkFilter(MotionColors to) {
    const sInk = 11 / 255, sRed = 222 / 255;
    final row = <double>[];
    for (final (tInk, tRed) in [(to.ink.r, to.red.r), (to.ink.g, to.red.g), (to.ink.b, to.red.b)]) {
      final a = (tRed - tInk) / (sRed - sInk);
      row.addAll([a, 0, 0, 0, (tInk - a * sInk) * 255]);
    }
    return ColorFilter.matrix([...row, 0, 0, 0, 1, 0]);
  }

  @override
  Widget build(BuildContext context) {
    final colors = MotionColors.of(context);
    final width = height * aspect[kind]!;
    final reduced = reducedMotion(context);
    final frame = CustomPaint(size: Size(width, height), painter: LoaderStillPainter(kind, colors, mono: mono));
    final animate = !reduced && !still;
    Widget art = animate
        ? Lottie.asset(
            asset(kind),
            width: width,
            height: height,
            fit: BoxFit.contain,
            repeat: true,
            // The JSON parses asynchronously: the still frame shows until the composition is ready.
            frameBuilder: (_, child, composition) => composition == null ? frame : child,
            errorBuilder: (_, _, _) => frame,
          )
        : frame;
    // The files carry the brand red on paper: a mono loader draws every shape in the text colour;
    // on ink the full-colour loader is recoloured to the on-ink pair.
    if (animate && mono) {
      art = ColorFiltered(colorFilter: ColorFilter.mode(colors.ink, BlendMode.srcIn), child: art);
    } else if (animate && colors.dark) {
      art = ColorFiltered(colorFilter: onInkFilter(colors), child: art);
    }
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
        // The mark: the two drops met at level (centres 2.19r apart, as the web's still frame), ink
        // left, red right, joined by the neck the goo draws on the web.
        canvas.drawRect(const Rect.fromLTRB(47.75, 27.5, 60, 44.5), ink);
        canvas.drawRect(const Rect.fromLTRB(60, 27.5, 72.25, 44.5), red);
        canvas.drawCircle(const Offset(47.75, 36), 11.2, ink);
        canvas.drawCircle(const Offset(72.25, 36), 11.2, red);
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
