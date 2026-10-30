import 'dart:convert';

/// Where an operation stands on the phone.
/// - pending: waiting to be sent (or re-sent after a lost answer: the server dedupes by opId)
/// - applied: the server applied it (or had already: a duplicate of an applied op)
/// - rejected: it can never apply (unknown item, bad payload); the user fixes it and makes a new op
/// - conflict: the server's stock won (e.g. a count under what confirmed orders hold); the user is told
enum OpStatus { pending, applied, rejected, conflict }

/// Operation types the server accepts (POST /v1/ops/sync, E8-3).
abstract final class OpTypes {
  static const stockReceive = 'stock.receive';
  static const stockCount = 'stock.count';
  static const stockAdjust = 'stock.adjust';
  static const returnInspect = 'return.inspect';
  static const orderPack = 'order.pack';
  static const all = {stockReceive, stockCount, stockAdjust, returnInspect, orderPack};
}

/// One thing done on the phone, queued until the server has it. `opId` is made once, here, and
/// sent with every retry: the server applies each opId exactly once (ADR-0005).
class Op {
  Op({
    required this.opId,
    required this.type,
    required this.payload,
    required this.at,
    this.status = OpStatus.pending,
    this.attempts = 0,
    this.code,
    this.message,
    this.result,
    this.syncedAt,
  });

  final String opId;
  final String type;
  final Map<String, Object?> payload;

  /// When it happened on the phone (UTC); the server applies ops in this order.
  final DateTime at;
  final OpStatus status;
  final int attempts;
  final String? code;
  final String? message;
  final Map<String, Object?>? result;
  final DateTime? syncedAt;

  /// The op as the sync endpoint takes it.
  Map<String, Object?> toWire() => {'opId': opId, 'type': type, 'payload': payload, 'at': at.toUtc().toIso8601String()};

  String get payloadJson => jsonEncode(payload);
}

/// The server's answer for one op.
class OpOutcome {
  const OpOutcome({required this.opId, required this.status, this.original, this.code, this.message, this.result});

  final String opId;

  /// applied | duplicate | rejected | conflict
  final String status;

  /// For a duplicate: what happened the first time (applied | rejected | conflict).
  final String? original;
  final String? code;
  final String? message;
  final Map<String, Object?>? result;

  /// What the phone records: a duplicate takes the first outcome; an unknown answer stays pending.
  OpStatus? get finalStatus {
    final s = status == 'duplicate' ? original : status;
    return switch (s) {
      'applied' => OpStatus.applied,
      'rejected' => OpStatus.rejected,
      'conflict' => OpStatus.conflict,
      _ => null,
    };
  }

  factory OpOutcome.fromJson(Map<String, Object?> j) => OpOutcome(
        opId: j['opId'] as String,
        status: j['status'] as String,
        original: j['original'] as String?,
        code: j['code'] as String?,
        message: j['message'] as String?,
        result: (j['result'] as Map?)?.cast<String, Object?>(),
      );
}
