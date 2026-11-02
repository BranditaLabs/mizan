import 'package:drift/drift.dart' show DatabaseConnection;
import 'package:drift/native.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mizan_ops/main.dart';
import 'package:mizan_ops/pick/pick_api.dart';
import 'package:mizan_ops/sync/op.dart';
import 'package:mizan_ops/sync/op_store.dart';
import 'package:mizan_ops/sync/sync_api.dart';
import 'package:mizan_ops/sync/sync_engine.dart';

import 'fake_server.dart';

class FakePickApi implements PickApi {
  bool offline = false;
  int fetches = 0;
  final lists = <String, Map<String, Object?>>{
    'list-1': {
      'id': 'list-1', 'number': 7, 'status': 'open', 'createdAt': '2026-10-30T08:00:00.000Z', 'closedAt': null,
      'items': [
        {'variantId': 'v-scarf', 'sku': 'SC-1', 'barcode': '6221000000002', 'title': 'Scarf', 'quantity': 2, 'bin': 'A-03-2'},
        {'variantId': 'v-abaya', 'sku': 'AB-1', 'barcode': '6221000000001', 'title': 'Abaya', 'quantity': 1, 'bin': 'C-11-1'},
      ],
      'orders': [
        {'id': 'order-a', 'number': '#1042', 'packedAt': null, 'lines': [
          {'variantId': 'v-abaya', 'sku': 'AB-1', 'barcode': '6221000000001', 'title': 'Abaya', 'quantity': 1},
          {'variantId': 'v-scarf', 'sku': 'SC-1', 'barcode': '6221000000002', 'title': 'Scarf', 'quantity': 2},
        ]},
        {'id': 'order-b', 'number': '#1043', 'packedAt': '2026-10-30T08:30:00.000Z', 'lines': [
          {'variantId': 'v-abaya', 'sku': 'AB-1', 'barcode': '6221000000001', 'title': 'Abaya', 'quantity': 1},
        ]},
      ],
    },
  };

  @override
  Future<List<String>> openListIds() async {
    if (offline) throw SyncFailure(SyncFailureKind.offline, 'no network');
    fetches++;
    return lists.keys.toList();
  }

  @override
  Future<Map<String, Object?>> list(String id) async => lists[id]!;
}

/// E8-4c on the phone: lists are fetched once and work offline; packing blocks a wrong item on
/// the spot, finishes only when every item is in, and syncs as one order.pack op.
void main() {
  late OpStore store;
  setUp(() => store = OpStore(DatabaseConnection(NativeDatabase.memory(), closeStreamsSynchronously: true)));
  tearDown(() => store.close());

  Future<void> settle(WidgetTester tester) async {
    await tester.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 60)));
    await tester.pumpAndSettle();
  }

  testWidgets('English: fetch the lists, pack an order by scans (a wrong one blocked), it syncs and shows packed', (tester) async {
    final api = FakePickApi();
    final server = FakeOpsServer();
    final engine = SyncEngine(store: store, api: server, deviceId: 'phone-1');
    void Function(String)? camera;
    await tester.pumpWidget(MizanOpsApp(store: store, engine: engine, pickApi: api, locale: const Locale('en'), scanner: (context, onCode) {
      camera = onCode;
      return const SizedBox.shrink();
    }));
    await settle(tester);
    await tester.tap(find.byKey(const Key('tab-pick')));
    await settle(tester);
    expect(find.textContaining('No pick list on this phone'), findsOneWidget);
    await tester.tap(find.byKey(const Key('refresh')));
    await settle(tester);
    expect(find.text('List 7'), findsOneWidget);
    expect(find.textContaining('2 orders · 1 packed'), findsOneWidget);

    await tester.tap(find.byKey(const Key('list-list-1')));
    await settle(tester);
    expect(find.text('To pick, by shelf'), findsOneWidget);
    expect(find.text('Packed'), findsOneWidget); // order B, packed before
    await tester.tap(find.text('Pack'));
    await settle(tester);

    camera!('6221000000099');
    await tester.pump();
    expect(find.text('Not on this order. Keep it out of the box.'), findsOneWidget);
    camera!('6221000000002');
    camera!('6221000000002'); // the same read twice in a second: one item
    await tester.pump();
    expect(find.text('Added: Scarf'), findsOneWidget);
    expect(find.text('1 of 3 items'), findsOneWidget);
    expect(tester.widget<FilledButton>(find.byKey(const Key('finish'))).onPressed, isNull);
    await tester.enterText(find.byKey(const Key('typed-code')), 'SC-1');
    await tester.tap(find.byKey(const Key('add-code')));
    await tester.enterText(find.byKey(const Key('typed-code')), '6221000000001');
    await tester.tap(find.byKey(const Key('add-code')));
    await tester.pump();
    expect(find.text('3 of 3 items'), findsOneWidget);
    await tester.ensureVisible(find.byKey(const Key('finish')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('finish')));
    await settle(tester);
    await settle(tester);

    final ops = (await tester.runAsync(() => store.recent()))!;
    final pack = ops.singleWhere((o) => o.type == OpTypes.orderPack);
    expect(pack.payload, {'orderId': 'order-a', 'items': [{'variantId': 'v-scarf', 'quantity': 2}, {'variantId': 'v-abaya', 'quantity': 1}], 'manual': true});
    expect(pack.status, OpStatus.applied);
    expect(server.calls, 1);
    expect(find.text('Packed'), findsNWidgets(2));
  });

  testWidgets('Arabic, offline: the cached list still opens, right to left', (tester) async {
    final api = FakePickApi();
    await tester.runAsync(() async {
      await store.savePickLists([await api.list('list-1')], DateTime.utc(2026, 10, 30, 9));
    });
    api.offline = true;
    await tester.pumpWidget(MizanOpsApp(store: store, pickApi: api, locale: const Locale('ar')));
    await settle(tester);
    await tester.tap(find.byKey(const Key('tab-pick')));
    await settle(tester);
    expect(find.text('قايمة 7'), findsOneWidget);
    await tester.tap(find.byKey(const Key('refresh')));
    await settle(tester);
    expect(find.text('مفيش نت. اتحفظ على الموبايل وميزان هياخده بعدين.'), findsOneWidget);
    await tester.tap(find.byKey(const Key('list-list-1')));
    await settle(tester);
    expect(Directionality.of(tester.element(find.text('هتاخد إيه، بالرف'))), TextDirection.rtl);
    expect(find.text('قفّل'), findsOneWidget);
  });
}
