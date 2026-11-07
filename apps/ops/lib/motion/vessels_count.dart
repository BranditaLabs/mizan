import 'package:flutter/material.dart';

import '../theme/mizan_tokens.dart';
import 'fill_bar.dart';
import 'motion.dart';

/// Connected vessels for one received line: what was ordered on the line's start side, what is in
/// on its end side. The received level springs up with each scan (spring.vessels); when the two
/// match, the liquid joins through the base (MERGE). Reduced motion: the levels at once.
class VesselsCount extends StatefulWidget {
  const VesselsCount({super.key, required this.expected, required this.received, this.label, this.width = 36, this.height = 28});

  final int expected;
  final int received;

  /// Read out (for example "3 of 5"); null when the numbers sit next to it.
  final String? label;
  final double width;
  final double height;

  double get level => expected <= 0 ? (received > 0 ? 1 : 0) : (received / expected).clamp(0.0, 1.0);

  @override
  State<VesselsCount> createState() => _VesselsCountState();
}

class _VesselsCountState extends State<VesselsCount> with SingleTickerProviderStateMixin, SpringValue {
  @override
  SpringDescription get springDescription => SpringDescription.withDampingRatio(mass: 1, stiffness: MizanMotion.springVesselsK, ratio: MizanMotion.springVesselsZ);

  bool _first = true;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (_first) {
      _first = false;
      springTo(widget.level, snap: true);
    }
  }

  @override
  void didUpdateWidget(VesselsCount old) {
    super.didUpdateWidget(old);
    if (old.level != widget.level) springTo(widget.level);
  }

  @override
  Widget build(BuildContext context) {
    final colors = MotionColors.of(context);
    final rtl = Directionality.of(context) == TextDirection.rtl;
    final art = AnimatedBuilder(
      animation: spring,
      // The glass is drawn plain; only the liquid goes through the goo filter, so it joins softly.
      builder: (context, _) => Stack(children: [
        CustomPaint(size: Size(widget.width, widget.height), painter: VesselsPainter(spring.value, colors, rtl: rtl, matched: widget.level >= 1, glass: true)),
        goo(
          CustomPaint(size: Size(widget.width, widget.height), painter: VesselsPainter(spring.value, colors, rtl: rtl, matched: widget.level >= 1)),
          blur: MizanMotion.gooInstrumentVessels / 3,
          a: MizanMotion.gooInstrumentMatrixA,
          b: MizanMotion.gooInstrumentMatrixB,
        ),
      ]),
    );
    final box = SizedBox(key: const ValueKey('vessels'), width: widget.width, height: widget.height, child: art);
    return widget.label == null ? ExcludeSemantics(child: box) : Semantics(label: widget.label, child: ExcludeSemantics(child: box));
  }
}

/// Two vessels and the base between them; [level] is the received side (0..1, overshoots allowed).
class VesselsPainter extends CustomPainter {
  VesselsPainter(this.level, this.colors, {this.rtl = false, this.matched = false, this.glass = false});

  final double level;
  final MotionColors colors;
  final bool rtl;
  final bool matched;

  /// The empty vessels (drawn without goo), or the liquid in them.
  final bool glass;

  @override
  void paint(Canvas canvas, Size size) {
    if (rtl) {
      canvas.translate(size.width, 0);
      canvas.scale(-1, 1);
    }
    final w = size.width, h = size.height;
    final vw = w * 0.34, r = vw / 2;
    final left = Rect.fromLTWH(0, 0, vw, h), right = Rect.fromLTWH(w - vw, 0, vw, h);
    if (glass) {
      final p = Paint()..color = colors.ink.withValues(alpha: 0.16)..isAntiAlias = true;
      for (final v in [left, right]) {
        canvas.drawRRect(RRect.fromRectAndRadius(v, Radius.circular(r)), p);
      }
      final b = h * 0.22;
      canvas.drawRRect(RRect.fromRectAndRadius(Rect.fromLTRB(r, h - b, w - r, h), Radius.circular(b / 2)), p);
      return;
    }
    final liquid = Paint()..color = colors.ink..isAntiAlias = true;
    // The ordered side is full; the received side rises to its share.
    canvas.drawRRect(RRect.fromRectAndRadius(left, Radius.circular(r)), liquid);
    final lv = level.clamp(0.0, 1.08);
    final top = (h - h * lv).clamp(0.0, h);
    if (lv > 0) canvas.drawRRect(RRect.fromRectAndRadius(Rect.fromLTRB(right.left, top, right.right, h), Radius.circular(r)), liquid);
    // The base fills and the two sides join once the counts match.
    if (matched) {
      final b = h * 0.5;
      canvas.drawRRect(RRect.fromRectAndRadius(Rect.fromLTRB(r, h - b, w - r, h), Radius.circular(b / 2)), liquid);
    }
  }

  @override
  bool shouldRepaint(VesselsPainter old) => old.level != level || old.colors != colors || old.rtl != rtl || old.matched != matched || old.glass != glass;
}
