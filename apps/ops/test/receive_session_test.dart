import 'package:flutter_test/flutter_test.dart';
import 'package:mizan_ops/receive/purchase_order.dart';
import 'package:mizan_ops/receive/receive_session.dart';
import 'package:mizan_ops/sync/op.dart';

final po = PurchaseOrder.fromJson({
  'id': 'po-1', 'number': 'PO-0001', 'status': 'partially_received', 'supplier': {'id': 's-1', 'name': 'Alex Textiles'}, 'expectedAt': '2026-11-05',
  'lines': [
    {'id': 'l-1', 'variantId': 'v-abaya', 'sku': 'AB-1', 'barcode': '6221000000001', 'title': 'Abaya', 'quantity': 10, 'received': 6, 'damaged': 1},
    {'id': 'l-2', 'variantId': 'v-scarf', 'sku': 'SC-1', 'barcode': null, 'title': 'Scarf', 'quantity': 5, 'received': 0, 'damaged': 0},
  ],
});

/// M16-3: receiving is checked on the phone against what is still expected.
void main() {
  test('counts good and damaged units up to what is still expected; a wrong item is blocked', () {
    final s = ReceiveSession(po);
    expect(po.left, 8);
    expect(s.scan('6221000000099'), ReceiveResult.wrongItem);
    expect(s.scan('6221000000001'), ReceiveResult.counted);
    expect(s.scan('6221000000001', damaged: true), ReceiveResult.counted);
    expect(s.scan('ab-1'), ReceiveResult.counted); // typed SKU, any case
    expect(s.scan('6221000000001'), ReceiveResult.tooMany); // 3 were left: more than ordered is for a manager
    expect(s.scan('sc-1'), ReceiveResult.counted);
    final abaya = po.lines.first;
    expect((s.good(abaya), s.damaged(abaya), s.expected(abaya)), (2, 1, 3));
    s.undo(abaya, damaged: true);
    expect(s.damaged(abaya), 0);
    final op = s.toOp(opId: 'op-1', at: DateTime.utc(2026, 10, 30, 9));
    expect(op.type, OpTypes.poReceive);
    expect(op.payload, {
      'purchaseOrderId': 'po-1',
      'items': [
        {'variantId': 'v-abaya', 'quantity': 2, 'damaged': 0},
        {'variantId': 'v-scarf', 'quantity': 1, 'damaged': 0},
      ],
    });
  });

  test('units received on this phone and not in the fetched PO yet are not expected again', () {
    final s = ReceiveSession(po, alreadyHere: {'v-abaya': 3});
    expect(s.expected(po.lines.first), 0);
    expect(s.scan('AB-1'), ReceiveResult.tooMany);
    expect(s.hasAny, isFalse);
    expect(() => s.toOp(opId: 'op-2', at: DateTime.utc(2026)), throwsStateError);
  });
}
