import 'package:flutter_test/flutter_test.dart';
import 'package:mizan_ops/pick/pack_session.dart';
import 'package:mizan_ops/pick/pick_list.dart';
import 'package:mizan_ops/sync/op.dart';

/// E8-4c: each scan is checked against the order on the phone; a wrong item never counts.
void main() {
  PickOrder order() => PickOrder.fromJson({
        'id': '11111111-1111-4111-8111-111111111111', 'number': '#1042', 'packedAt': null,
        'lines': [
          {'variantId': 'v-abaya', 'sku': 'AB-1', 'barcode': '6221000000001', 'title': 'Abaya', 'quantity': 1},
          {'variantId': 'v-scarf', 'sku': 'SC-1', 'barcode': '6221000000002', 'title': 'Scarf', 'quantity': 1},
          {'variantId': 'v-scarf', 'sku': 'SC-1', 'barcode': '6221000000002', 'title': 'Scarf', 'quantity': 1}, // the same item on two lines
          {'variantId': null, 'sku': 'GIFT', 'barcode': null, 'title': 'Gift wrap', 'quantity': 1},
        ],
      });

  test('scans count against the order; a wrong item is blocked; too many is refused', () {
    final s = PackSession(order());
    expect(s.totalWanted, 4);
    expect(s.lines, hasLength(3)); // one per item
    expect(s.scan('6221000000099'), ScanResult.wrongItem);
    expect(s.totalScanned, 0);
    expect(s.scan('6221000000002'), ScanResult.counted);
    expect(s.scan('sc-1'), ScanResult.counted); // a typed SKU, any case
    expect(s.scan('6221000000002'), ScanResult.tooMany);
    expect(s.complete, isFalse);
    expect(() => s.toOp(opId: 'x', at: DateTime.utc(2026)), throwsStateError);
  });

  test('complete: one order.pack op with what was scanned, marked manual when a code was typed', () {
    final s = PackSession(order());
    s.scan('6221000000001');
    s.scan('6221000000002');
    s.scan('6221000000002');
    s.scan('GIFT', manual: true);
    expect(s.complete, isTrue);
    final op = s.toOp(opId: 'op-pack-0001', at: DateTime.utc(2026, 10, 30, 10));
    expect(op.type, OpTypes.orderPack);
    expect(op.payload, {
      'orderId': '11111111-1111-4111-8111-111111111111',
      'items': [{'variantId': 'v-abaya', 'quantity': 1}, {'variantId': 'v-scarf', 'quantity': 2}, {'sku': 'GIFT', 'quantity': 1}],
      'manual': true,
    });
  });

  test('a scan by mistake can be taken back out', () {
    final s = PackSession(order());
    s.scan('AB-1');
    final abaya = s.lines.first;
    s.undo(abaya);
    expect(s.scanned(abaya), 0);
    s.undo(abaya); // never below zero
    expect(s.scanned(abaya), 0);
  });
}
