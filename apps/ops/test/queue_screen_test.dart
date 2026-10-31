import 'package:drift/drift.dart' show DatabaseConnection;
import 'package:drift/native.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mizan_ops/main.dart';
import 'package:mizan_ops/sync/op.dart';
import 'package:mizan_ops/sync/op_store.dart';
import 'package:mizan_ops/sync/sync_engine.dart';

import 'fake_server.dart';

/// E8-4 part 1 in the app: count an item offline, in Arabic (right to left) or English; it syncs
/// when there is a session, and its state shows.
void main() {
  late OpStore store;
  setUp(() => store = OpStore(DatabaseConnection(NativeDatabase.memory(), closeStreamsSynchronously: true)));
  tearDown(() => store.close());

  Future<void> count(WidgetTester tester, String code, String qty) async {
    await tester.enterText(find.byKey(const Key('code')), code);
    await tester.enterText(find.byKey(const Key('quantity')), qty);
    await tester.tap(find.byKey(const Key('save')));
    await tester.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 50)));
    await tester.pumpAndSettle();
  }

  testWidgets('Arabic by default, right to left: a count is saved on the phone without signing in', (tester) async {
    await tester.pumpWidget(MizanOpsApp(store: store, locale: const Locale('ar')));
    await tester.pumpAndSettle();
    expect(Directionality.of(tester.element(find.byKey(const Key('pending')))), TextDirection.rtl);
    expect(find.text('المخزون على الموبايل ده'), findsOneWidget);
    expect(find.text('سجّل دخول عشان تزامن دول مع ميزان.'), findsOneWidget);

    await count(tester, '', '');
    expect(find.text('اكتب الباركود أو الـ SKU'), findsOneWidget);
    expect(find.text('اكتب رقم صحيح، صفر أو أكتر'), findsOneWidget);

    await count(tester, '6221234567890', '12');
    final queued = await tester.runAsync(() => store.pending());
    expect(queued!.single.type, OpTypes.stockCount);
    expect(queued.single.payload, {'barcode': '6221234567890', 'quantity': 12});
    expect(find.text('مستني'), findsOneWidget);
  });

  testWidgets('English, signed in: the count syncs and shows done; an unknown SKU shows why', (tester) async {
    final server = FakeOpsServer();
    final engine = SyncEngine(store: store, api: server, deviceId: 'phone-1');
    await tester.pumpWidget(MizanOpsApp(store: store, engine: engine, locale: const Locale('en')));
    await tester.pumpAndSettle();
    expect(Directionality.of(tester.element(find.byKey(const Key('pending')))), TextDirection.ltr);
    await count(tester, 'AB-1', '5');
    await tester.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 50)));
    await tester.pumpAndSettle();
    expect(find.text('Done'), findsOneWidget);
    await count(tester, 'NOPE', '1');
    await tester.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 50)));
    await tester.pumpAndSettle();
    expect(find.text('Not accepted'), findsOneWidget);
    expect(find.text('no item with this SKU'), findsOneWidget);
    expect(server.calls, 2);
  });
}
