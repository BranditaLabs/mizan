/// A purchase order as the API serves it (GET /v1/purchase-orders/{id}, M16-1): its lines with
/// what has arrived so far. The phone receives against it offline.
class PoLine {
  const PoLine({required this.id, required this.variantId, this.sku, this.barcode, required this.title, required this.quantity, required this.received, required this.damaged});

  final String id;
  final String variantId;
  final String? sku;
  final String? barcode;
  final String title;
  final int quantity;
  final int received;
  final int damaged;

  /// Still expected, as of the fetch.
  int get left => (quantity - received - damaged).clamp(0, quantity);

  factory PoLine.fromJson(Map<String, Object?> j) => PoLine(
    id: j['id'] as String,
    variantId: j['variantId'] as String,
    sku: j['sku'] as String?,
    barcode: j['barcode'] as String?,
    title: j['title'] as String? ?? '',
    quantity: (j['quantity'] as num?)?.toInt() ?? 0,
    received: (j['received'] as num?)?.toInt() ?? 0,
    damaged: (j['damaged'] as num?)?.toInt() ?? 0,
  );
}

class PurchaseOrder {
  const PurchaseOrder({required this.id, required this.number, required this.status, required this.supplier, this.expectedAt, required this.lines});

  final String id;
  final String number;

  /// approved | sent | partially_received (the ones the phone gets)
  final String status;
  final String supplier;
  final String? expectedAt;
  final List<PoLine> lines;

  int get left => lines.fold(0, (s, l) => s + l.left);

  factory PurchaseOrder.fromJson(Map<String, Object?> j) => PurchaseOrder(
    id: j['id'] as String,
    number: j['number'] as String,
    status: j['status'] as String? ?? 'sent',
    supplier: ((j['supplier'] as Map?)?['name'] as String?) ?? '',
    expectedAt: j['expectedAt'] as String?,
    lines: [for (final l in (j['lines'] as List? ?? const [])) PoLine.fromJson((l as Map).cast<String, Object?>())],
  );
}
