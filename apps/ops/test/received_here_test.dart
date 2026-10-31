import 'package:drift/drift.dart' show DatabaseConnection;
import 'package:drift/native.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mizan_ops/sync/op.dart';
import 'package:mizan_ops/sync/op_store.dart';

/// M16-3: what this phone received that the fetched PO cannot show yet (phone time only).
void main() {
  test('pending, or received after the fetch (or in its second), counts; refused or older applied does not', () async {
    final store = OpStore(DatabaseConnection(NativeDatabase.memory(), closeStreamsSynchronously: true));
    final fetched = DateTime.utc(2026, 10, 30, 9);
    Op receipt(String id, DateTime at, int qty, {String po = 'po-1'}) => Op(opId: id, type: OpTypes.poReceive, at: at, payload: {
          'purchaseOrderId': po,
          'items': [{'variantId': 'v-abaya', 'quantity': qty, 'damaged': 1}],
        });
    await store.enqueue(receipt('before-applied', fetched.subtract(const Duration(minutes: 5)), 4));
    await store.enqueue(receipt('after-applied', fetched.add(const Duration(minutes: 5)), 2));
    await store.enqueue(receipt('pending-old', fetched.subtract(const Duration(hours: 1)), 3));
    await store.enqueue(receipt('refused', fetched.add(const Duration(minutes: 6)), 9));
    await store.enqueue(receipt('other-po', fetched.add(const Duration(minutes: 7)), 9, po: 'po-2'));
    // Received in the same second as the fetch (times are stored to the second): still counts here.
    await store.enqueue(receipt('same-second', fetched.add(const Duration(milliseconds: 400)), 1));
    // The server's clock is not the phone's: syncedAt plays no part.
    await store.record([
      const OpOutcome(opId: 'before-applied', status: 'applied'),
      const OpOutcome(opId: 'after-applied', status: 'applied'),
      const OpOutcome(opId: 'same-second', status: 'applied'),
      const OpOutcome(opId: 'refused', status: 'conflict', code: 'over_receipt'),
    ], DateTime.utc(2020));
    expect(await store.receivedHere('po-1', fetched), {'v-abaya': (2 + 1) + (3 + 1) + (1 + 1)});
    await store.close();
  });
}
