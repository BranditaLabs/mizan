import '../sync/op.dart';
import 'pick_list.dart';

/// What a scan did.
enum ScanResult {
  /// The item is on the order and still needed.
  counted,

  /// Not on this order: blocked, nothing changes (the spec: a wrong SKU blocks packing).
  wrongItem,

  /// On the order, but all of it is already in the box.
  tooMany,
}

/// Packing one order on the phone (E8-4c): every scan is checked against the order there and
/// then — offline too — so a wrong item never reaches the box. When everything is in, the box
/// becomes one `order.pack` op with what was scanned; the server checks it again.
class PackSession {
  PackSession(this.order) {
    for (final l in order.lines) {
      final key = _key(l);
      _want[key] = (_want[key] ?? 0) + l.quantity;
      _lines[key] = l;
    }
  }

  final PickOrder order;
  final Map<String, int> _want = {};
  final Map<String, int> _got = {};
  final Map<String, PickLine> _lines = {};
  bool _manual = false;

  static String _key(PickLine l) => l.variantId ?? 'sku:${l.sku ?? l.title}';

  /// The order's line for a scanned or typed code: its barcode, else its SKU (case does not matter).
  PickLine? lineFor(String code) {
    final c = code.trim();
    if (c.isEmpty) return null;
    for (final l in _lines.values) {
      if (l.barcode != null && l.barcode == c) return l;
    }
    for (final l in _lines.values) {
      if (l.sku != null && l.sku!.toLowerCase() == c.toLowerCase()) return l;
    }
    return null;
  }

  /// A camera scan, or a code typed because the barcode would not read (`manual`, logged as such).
  ScanResult scan(String code, {bool manual = false}) {
    final line = lineFor(code);
    if (line == null) return ScanResult.wrongItem;
    final key = _key(line);
    if ((_got[key] ?? 0) >= _want[key]!) return ScanResult.tooMany;
    _got[key] = (_got[key] ?? 0) + 1;
    if (manual) _manual = true;
    return ScanResult.counted;
  }

  /// Take one back out of the box (a scan by mistake).
  void undo(PickLine line) {
    final key = _key(line);
    final n = _got[key] ?? 0;
    if (n > 0) _got[key] = n - 1;
  }

  int scanned(PickLine line) => _got[_key(line)] ?? 0;
  int wanted(PickLine line) => _want[_key(line)] ?? 0;

  /// The order's lines, one per item, for the screen.
  List<PickLine> get lines => _lines.values.toList();

  int get totalWanted => _want.values.fold(0, (a, b) => a + b);
  int get totalScanned => _got.values.fold(0, (a, b) => a + b);
  bool get complete => _want.entries.every((e) => (_got[e.key] ?? 0) == e.value);

  /// The box as an `order.pack` op (only when complete).
  Op toOp({required String opId, required DateTime at}) {
    if (!complete) throw StateError('the order is not complete');
    return Op(
      opId: opId,
      type: OpTypes.orderPack,
      at: at.toUtc(),
      payload: {
        'orderId': order.id,
        'items': [
          for (final e in _got.entries.where((e) => e.value > 0))
            {
              ...(_lines[e.key]!.variantId != null
                  ? {'variantId': _lines[e.key]!.variantId}
                  : _lines[e.key]!.barcode != null
                      ? {'barcode': _lines[e.key]!.barcode}
                      : {'sku': _lines[e.key]!.sku ?? _lines[e.key]!.title}),
              'quantity': e.value,
            },
        ],
        'manual': _manual,
      },
    );
  }
}
