/// A pick list as the API serves it (GET /v1/picklists/{id}, E8-4c): what to take from the
/// shelves, sorted by shelf (bin), and each order with the items to scan into its box.
class PickLine {
  const PickLine({this.variantId, this.sku, this.barcode, required this.title, required this.quantity, this.bin});

  final String? variantId;
  final String? sku;
  final String? barcode;
  final String title;
  final int quantity;

  /// Shelf location (items only).
  final String? bin;

  factory PickLine.fromJson(Map<String, Object?> j) => PickLine(
        variantId: j['variantId'] as String?,
        sku: j['sku'] as String?,
        barcode: j['barcode'] as String?,
        title: j['title'] as String? ?? '',
        quantity: (j['quantity'] as num?)?.toInt() ?? 0,
        bin: j['bin'] as String?,
      );
}

class PickOrder {
  const PickOrder({required this.id, required this.number, this.packedAt, required this.lines});

  final String id;
  final String number;
  final DateTime? packedAt;
  final List<PickLine> lines;

  bool get packed => packedAt != null;

  factory PickOrder.fromJson(Map<String, Object?> j) => PickOrder(
        id: j['id'] as String,
        number: j['number'] as String,
        packedAt: j['packedAt'] == null ? null : DateTime.parse(j['packedAt'] as String),
        lines: [for (final l in (j['lines'] as List? ?? const [])) PickLine.fromJson((l as Map).cast<String, Object?>())],
      );
}

class PickList {
  const PickList({required this.id, required this.number, required this.status, required this.items, required this.orders});

  final String id;
  final int number;

  /// open | closed
  final String status;
  final List<PickLine> items;
  final List<PickOrder> orders;

  factory PickList.fromJson(Map<String, Object?> j) => PickList(
        id: j['id'] as String,
        number: (j['number'] as num).toInt(),
        status: j['status'] as String? ?? 'open',
        items: [for (final l in (j['items'] as List? ?? const [])) PickLine.fromJson((l as Map).cast<String, Object?>())],
        orders: [for (final o in (j['orders'] as List? ?? const [])) PickOrder.fromJson((o as Map).cast<String, Object?>())],
      );
}
