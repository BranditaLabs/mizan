import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:lottie/lottie.dart';
import 'package:mizan_ops/motion/event_glyph.dart';
import 'package:mizan_ops/motion/fill_bar.dart';
import 'package:mizan_ops/motion/mizan_loader.dart';
import 'package:mizan_ops/motion/motion.dart';
import 'package:mizan_ops/motion/vessels_count.dart';
import 'package:mizan_ops/theme/mizan_tokens.dart';

/// Brand 2.0 motion in the ops app (BR-3): the loaders, the fill bar, the vessels and the glyphs
/// follow the catalogue, respect reduced motion (still frames, no ticking), and the old Material
/// spinners are gone.
void main() {
  Widget host(Widget child, {bool reduced = false, ThemeData? theme, TextDirection dir = TextDirection.ltr}) => MaterialApp(
    theme: theme ?? mizanLightTheme,
    debugShowCheckedModeBanner: false,
    home: MediaQuery(
      data: MediaQueryData(disableAnimations: reduced),
      child: Directionality(
        textDirection: dir,
        child: Scaffold(
          body: Center(child: RepaintBoundary(child: child)),
        ),
      ),
    ),
  );

  group('reduced motion: still frames (goldens)', () {
    for (final kind in [MotionPending.pair, MotionPending.transfer, MotionPending.drop]) {
      testWidgets('MizanLoader ${kind.name}', (tester) async {
        await tester.pumpWidget(host(MizanLoader(kind, height: 72), reduced: true));
        expect(find.byType(Lottie), findsNothing);
        await tester.pump();
        expect(tester.binding.transientCallbackCount, 0, reason: 'nothing ticks');
        await expectLater(find.byType(RepaintBoundary).last, matchesGoldenFile('goldens/loader_${kind.name}_reduced.png'));
      });
    }

    testWidgets('FillBar: the width at once, with the percentage as text', (tester) async {
      await tester.pumpWidget(host(const SizedBox(width: 240, child: FillBar(done: 2, total: 3)), reduced: true));
      expect(find.text('\u206667%\u2069'), findsOneWidget);
      await tester.pump();
      expect(tester.binding.transientCallbackCount, 0, reason: 'nothing ticks');
      await expectLater(find.byType(RepaintBoundary).last, matchesGoldenFile('goldens/fill_bar_reduced.png'));
    });

    testWidgets('VesselsCount: part received, then matched', (tester) async {
      await tester.pumpWidget(
        host(const Row(mainAxisSize: MainAxisSize.min, children: [VesselsCount(expected: 5, received: 2), SizedBox(width: 12), VesselsCount(expected: 5, received: 5)]), reduced: true),
      );
      await tester.pump();
      expect(tester.binding.transientCallbackCount, 0, reason: 'nothing ticks');
      await expectLater(find.byType(RepaintBoundary).last, matchesGoldenFile('goldens/vessels_reduced.png'));
    });

    testWidgets('EventGlyph shows its end frame at once', (tester) async {
      await tester.pumpWidget(host(const EventGlyph(MotionOutcome.done, size: 48), reduced: true));
      await tester.pump();
      expect(tester.binding.transientCallbackCount, 0, reason: 'nothing ticks');
      final p = tester.widget<CustomPaint>(find.descendant(of: find.byType(EventGlyph), matching: find.byType(CustomPaint))).painter! as EventGlyphPainter;
      expect(p.t, 1);
    });
  });

  group('motion', () {
    testWidgets('the loader is the pack Lottie on paper; the first frame is the still frame, never blank', (tester) async {
      await tester.pumpWidget(host(const MizanLoader(MotionPending.transfer)));
      expect(find.byType(LottieBuilder), findsOneWidget);
      // Before the JSON is parsed (the first frame at boot), the builder shows the still frame.
      expect(find.descendant(of: find.byType(LottieBuilder), matching: find.byWidgetPredicate((w) => w is CustomPaint && w.painter is LoaderStillPainter)), findsOneWidget);
      expect(MizanLoader.asset(MotionPending.transfer), 'assets/lottie/mizan-transfer-on-paper.json');
    });

    test('on ink, the colour matrix maps the file\'s ink and red onto the on-ink pair', () {
      final m = MizanLoader.onInkFilter(MotionColors.onInk).toString();
      expect(m, contains('matrix'));
      // Applied by hand: ink (11) → paper (254, 247, 255); red (222) → red on ink (227, 50, 50).
      List<int> apply(double r) {
        final to = MotionColors.onInk;
        final out = <int>[];
        for (final (tInk, tRed) in [(to.ink.r, to.red.r), (to.ink.g, to.red.g), (to.ink.b, to.red.b)]) {
          final a = (tRed - tInk) / ((222 - 11) / 255);
          out.add(((a * r + (tInk - a * 11 / 255)) * 255).round());
        }
        return out;
      }
      expect(apply(11 / 255), [254, 247, 255]);
      expect(apply(222 / 255), [227, 50, 50]);
    });

    testWidgets('a still EventLoader (a queue row) has no Lottie and no layer', (tester) async {
      await tester.pumpWidget(host(const EventLoader('ops.syncing', still: true)));
      expect(find.byType(Lottie), findsNothing);
      expect(find.byType(ColorFiltered), findsNothing);
    });

    testWidgets('EventLoader picks the loader from the catalogue, never from the screen', (tester) async {
      await tester.pumpWidget(host(const EventLoader('ops.syncing'), reduced: true));
      expect(find.byKey(const ValueKey('loader-transfer')), findsOneWidget);
      await tester.pumpWidget(host(const EventLoader('ops.loading'), reduced: true));
      expect(find.byKey(const ValueKey('loader-pair')), findsOneWidget);
    });

    testWidgets('a glyph plays once and stops (no endless ticking)', (tester) async {
      await tester.pumpWidget(host(const EventGlyph(MotionOutcome.drop)));
      expect(tester.binding.transientCallbackCount, greaterThan(0));
      await tester.pumpAndSettle();
      await tester.pump();
      expect(tester.binding.transientCallbackCount, 0, reason: 'nothing ticks');
    });

    testWidgets('a new fill value flows from the current one and rests', (tester) async {
      FillPainter painter() => tester.widget<CustomPaint>(find.descendant(of: find.byType(FillBar), matching: find.byType(CustomPaint)).last).painter! as FillPainter;
      await tester.pumpWidget(host(const SizedBox(width: 240, child: FillBar(done: 1, total: 4))));
      expect(painter().v, closeTo(0.25, 0.001));
      await tester.pumpWidget(host(const SizedBox(width: 240, child: FillBar(done: 3, total: 4))));
      await tester.pump(const Duration(milliseconds: 50));
      expect(painter().v, greaterThan(0.25));
      expect(painter().v, lessThan(0.75));
      await tester.pumpAndSettle();
      expect(painter().v, closeTo(0.75, 0.001));
    });

    testWidgets('the tip glyph mirrors in Arabic and holds its tilt', (tester) async {
      await tester.pumpWidget(host(const TipGlyph(), reduced: true, dir: TextDirection.rtl));
      final p = tester.widget<CustomPaint>(find.descendant(of: find.byType(TipGlyph), matching: find.byType(CustomPaint))).painter! as EventGlyphPainter;
      expect(p.rtl, isTrue);
      expect(p.t, 1);
    });
  });

  group('catalogue', () {
    test('the phone\'s own events never shadow a domain event', () {
      for (final k in opsEventMotion.keys) {
        expect(eventMotion.containsKey(k), isFalse, reason: k);
        expect(k.startsWith('ops.'), isTrue, reason: k);
      }
    });

    test('every event a screen names is in the catalogue', () {
      // Event names passed to the motion API, and every phone event named anywhere outside the catalogue.
      final uses = RegExp(r"(?:showEventSnack\(\s*context,\s*|EventLoader\(\s*|motionOf\(\s*)'([a-z_.]+)'|'(ops\.[a-z_]+)'");
      final named = <String>{};
      for (final f in Directory('lib').listSync(recursive: true).whereType<File>().where((f) => f.path.endsWith('.dart') && !f.path.endsWith('motion.dart'))) {
        for (final m in uses.allMatches(f.readAsStringSync())) {
          named.add(m.group(1) ?? m.group(2)!);
        }
      }
      expect(named, containsAll(<String>['order.packed', 'stock.received', 'stock.adjusted', 'ops.syncing', 'ops.loading', 'ops.sync_failed', 'ops.scan_counted', 'ops.scan_blocked']));
      for (final type in named) {
        expect(() => motionOf(type), returnsNormally, reason: type);
      }
    });

    test('the loaders\' Lottie files are bundled', () {
      expect(File('pubspec.yaml').readAsStringSync(), contains('- assets/lottie/'));
      for (final kind in [MotionPending.pair, MotionPending.transfer, MotionPending.drop]) {
        expect(File(MizanLoader.asset(kind)).existsSync(), isTrue, reason: MizanLoader.asset(kind));
      }
    });

    test('no Material spinners or progress bars in lib (Brand 2.0 loaders only)', () {
      final banned = RegExp(r'\b(CircularProgressIndicator|LinearProgressIndicator)\b');
      for (final f in Directory('lib').listSync(recursive: true).whereType<File>().where((f) => f.path.endsWith('.dart'))) {
        expect(banned.hasMatch(f.readAsStringSync()), isFalse, reason: f.path);
      }
    });
  });
}
