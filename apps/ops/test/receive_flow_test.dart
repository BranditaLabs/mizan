import 'package:drift/drift.dart' show DatabaseConnection;
import 'package:drift/native.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mizan_ops/main.dart';
import 'package:mizan_ops/receive/receive_api.dart';
import 'package:mizan_ops/sync/op.dart';
import 'package:mizan_ops/sync/op_store.dart';
import 'package:mizan_ops/sync/sync_api.dart';
import 'package:mizan_ops/sync/sync_engine.dart';

import 'fake_server.dart';

class FakeReceiveApi implements ReceiveApi {
  bool offline = false;
  final pos = <String, Map<String, Object?>>{
    'po-1': {
      'id': 'po-1', 'number': 'PO-0001', 'status': 'sent', 'supplier': {'id': 's-1', 'name': 'Alex Textiles'}, 'expectedAt': '2026-11-05',
      'lines': [
        {'id': 'l-1', 'variantId': 'v-abaya', 'sku': 'AB-1', 'barcode': '6221000000001', 'title': 'Abaya', 'quantity': 3, 'received': 0, 'damaged': 0},
        {'id': 'l-2', 'variantId': 'v-scarf', 'sku': 'SC-1', 'barcode': '6221000000002', 'title': 'Scarf', 'quantity': 2, 'received': 0, 'damaged': 0},
      ],
    },
  };

  @override
  Future<List<String>> openPoIds() async {
    if (offline) throw SyncFailure(SyncFailureKind.offline, 'no network');
    return pos.keys.toList();
  }

  @override
  Future<Map<String, Object?>> po(String id) async => pos[id]!;
}

/// M16-3 on the phone: open POs are fetched once and work offline; receiving blocks a wrong item
/// and more than ordered on the spot, counts damaged apart, and syncs as one po.receive op.
void main() {
  late OpStore store;
  setUp(() => store = OpStore(DatabaseConnection(NativeDatabase.memory(), closeStreamsSynchronously: true)));
  tearDown(() => store.close());

  Future<void> settle(WidgetTester tester) async {
    await tester.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 60)));
    await tester.pumpAndSettle();
  }

  testWidgets('English: fetch the POs, receive part of a delivery by scans, it syncs once', (tester) async {
    final api = FakeReceiveApi();
    final server = FakeOpsServer();
    final engine = SyncEngine(store: store, api: server, deviceId: 'phone-1');
    void Function(String)? camera;
    await tester.pumpWidget(MizanOpsApp(store: store, engine: engine, receiveApi: api, locale: const Locale('en'), scanner: (context, onCode) {
      camera = onCode;
      return const SizedBox.shrink();
    }));
    await settle(tester);
    await tester.tap(find.byKey(const Key('tab-receive')));
    await settle(tester);
    expect(find.textContaining('No purchase order on this phone'), findsOneWidget);
    await tester.tap(find.byKey(const Key('refresh-pos')));
    await settle(tester);
    expect(find.textContaining('5 units still expected'), findsOneWidget);
    await tester.tap(find.byKey(const Key('po-po-1')));
    await settle(tester);

    expect(tester.widget<FilledButton>(find.byKey(const Key('save-delivery'))).onPressed, isNull);
    camera!('6221000000099');
    await tester.pump();
    expect(find.text('Not on this purchase order. Put it aside.'), findsOneWidget);
    camera!('6221000000001');
    await tester.pump();
    expect(find.text('Received: Abaya'), findsOneWidget);
    await tester.tap(find.byKey(const Key('damaged-mode')));
    await tester.pump();
    await tester.enterText(find.byKey(const Key('typed-code')), 'AB-1');
    await tester.tap(find.byKey(const Key('add-code')));
    await tester.pump();
    expect(find.text('Damaged: Abaya'), findsOneWidget);
    await tester.tap(find.byKey(const Key('damaged-mode')));
    await tester.enterText(find.byKey(const Key('typed-code')), 'AB-1');
    await tester.tap(find.byKey(const Key('add-code')));
    await tester.enterText(find.byKey(const Key('typed-code')), 'AB-1');
    await tester.tap(find.byKey(const Key('add-code')));
    await tester.pump();
    expect(find.textContaining('More than ordered needs a manager'), findsOneWidget);
    expect(find.text('2 good · 1 damaged'), findsOneWidget);
    await tester.ensureVisible(find.byKey(const Key('save-delivery')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('save-delivery')));
    await settle(tester);
    await settle(tester);

    final ops = (await tester.runAsync(() => store.recent()))!;
    final receipt = ops.singleWhere((o) => o.type == OpTypes.poReceive);
    expect(receipt.payload, {'purchaseOrderId': 'po-1', 'items': [{'variantId': 'v-abaya', 'quantity': 2, 'damaged': 1}]});
    expect(receipt.status, OpStatus.applied);
    expect(server.timesApplied(receipt.opId), 1);
    // Until the next fetch, what this phone received is not expected again.
    expect(find.textContaining('2 units still expected'), findsOneWidget);
  });

  testWidgets('Arabic, offline: the cached PO still opens, right to left, and the delivery waits in the queue', (tester) async {
    final api = FakeReceiveApi();
    await tester.runAsync(() async => store.savePurchaseOrders([await api.po('po-1')], DateTime.utc(2026, 10, 30, 9)));
    api.offline = true;
    await tester.pumpWidget(MizanOpsApp(store: store, receiveApi: api, locale: const Locale('ar')));
    await settle(tester);
    await tester.tap(find.byKey(const Key('tab-receive')));
    await settle(tester);
    await tester.tap(find.byKey(const Key('refresh-pos')));
    await settle(tester);
    expect(find.text('مفيش نت. اتحفظ على الموبايل وميزان هياخده بعدين.'), findsOneWidget);
    await tester.tap(find.byKey(const Key('po-po-1')));
    await settle(tester);
    expect(Directionality.of(tester.element(find.text('اعمل سكان لكل قطعة وهي نازلة من التسليم.'))), TextDirection.rtl);
    await tester.enterText(find.byKey(const Key('typed-code')), '6221000000002');
    await tester.tap(find.byKey(const Key('add-code')));
    await tester.pump();
    expect(find.text('اتستلم: Scarf'), findsOneWidget);
    await tester.ensureVisible(find.byKey(const Key('save-delivery')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('save-delivery')));
    await settle(tester);
    final ops = (await tester.runAsync(() => store.recent()))!;
    expect(ops.single.status, OpStatus.pending);
    expect(find.textContaining('4 قطع لسه جايين'), findsOneWidget); // 4 left after 1 received here
  });
}
