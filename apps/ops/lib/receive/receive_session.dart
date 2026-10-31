import '../sync/op.dart';
import 'purchase_order.dart';

/// What a scan did while receiving.
enum ReceiveResult {
  /// Counted (as good, or as damaged in damaged mode).
  counted,

  /// Not on this purchase order: put aside, nothing counted.
  wrongItem,

  /// Everything expected for this item is in: more than ordered needs a manager on the web.
  tooMany,
}

/// Receiving a delivery against a purchase order on the phone (M16-3): each scan is checked
/// against what is still expected — offline too — so the app never sends more than ordered (the
/// server would refuse it as a conflict). Damaged items are counted apart; they are recorded, not
/// stocked. Partial deliveries are fine: the delivery becomes one `po.receive` op.
class ReceiveSession {
  /// [alreadyHere]: units of each variant received on this phone since the PO was fetched (not in its numbers yet).
  ReceiveSession(this.po, {Map<String, int> alreadyHere = const {}}) {
    for (final l in po.lines) {
      _left[l.variantId] = (l.left - (alreadyHere[l.variantId] ?? 0)).clamp(0, l.quantity);
    }
  }

  final PurchaseOrder po;
  final Map<String, int> _left = {};
  final Map<String, int> _good = {};
  final Map<String, int> _damaged = {};

  /// The PO's line for a scanned or typed code: its barcode, else its SKU (case does not matter).
  PoLine? lineFor(String code) {
    final c = code.trim();
    if (c.isEmpty) return null;
    for (final l in po.lines) {
      if (l.barcode != null && l.barcode == c) return l;
    }
    for (final l in po.lines) {
      if (l.sku != null && l.sku!.toLowerCase() == c.toLowerCase()) return l;
    }
    return null;
  }

  ReceiveResult scan(String code, {bool damaged = false}) {
    final line = lineFor(code);
    if (line == null) return ReceiveResult.wrongItem;
    if (counted(line) >= expected(line)) return ReceiveResult.tooMany;
    final into = damaged ? _damaged : _good;
    into[line.variantId] = (into[line.variantId] ?? 0) + 1;
    return ReceiveResult.counted;
  }

  /// Take one back (a scan by mistake): damaged first when [damaged], else good.
  void undo(PoLine line, {bool damaged = false}) {
    final from = damaged ? _damaged : _good;
    final n = from[line.variantId] ?? 0;
    if (n > 0) from[line.variantId] = n - 1;
  }

  int good(PoLine l) => _good[l.variantId] ?? 0;
  int damaged(PoLine l) => _damaged[l.variantId] ?? 0;
  int counted(PoLine l) => good(l) + damaged(l);
  int expected(PoLine l) => _left[l.variantId] ?? 0;

  int get totalGood => _good.values.fold(0, (a, b) => a + b);
  int get totalDamaged => _damaged.values.fold(0, (a, b) => a + b);
  bool get hasAny => totalGood + totalDamaged > 0;

  /// The delivery as a `po.receive` op (when anything was counted).
  Op toOp({required String opId, required DateTime at}) {
    if (!hasAny) throw StateError('nothing was received');
    return Op(
      opId: opId,
      type: OpTypes.poReceive,
      at: at.toUtc(),
      payload: {
        'purchaseOrderId': po.id,
        'items': [
          for (final l in po.lines)
            if (counted(l) > 0) {'variantId': l.variantId, 'quantity': good(l), 'damaged': damaged(l)},
        ],
      },
    );
  }
}
