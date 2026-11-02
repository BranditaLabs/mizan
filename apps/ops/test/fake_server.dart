import 'dart:math';

import 'package:mizan_ops/sync/op.dart';
import 'package:mizan_ops/sync/sync_api.dart';

/// Mizan's POST /v1/ops/sync, in memory: each opId is applied once (the first outcome is kept and
/// a replay gets it back as a duplicate), ops apply in the order they happened. It can misbehave:
/// fail before applying (offline, 503), or apply and then lose the answer.
class FakeOpsServer implements SyncApi {
  FakeOpsServer({Random? random}) : _random = random ?? Random(1);

  final Random _random;
  final Map<String, OpOutcome> _outcomes = {};
  final List<String> appliedOrder = [];
  int calls = 0;
  int batchesSeen = 0;
  double faultRate = 0;
  bool down = false;
  bool signedOut = false;
  final List<String> faults = [];

  /// Stock the server holds per SKU, and what confirmed orders reserve (a count under it conflicts).
  final Map<String, int> reserved = {};

  int timesApplied(String opId) => appliedOrder.where((id) => id == opId).length;

  @override
  Future<List<OpOutcome>> sync(String deviceId, List<Op> ops) async {
    calls++;
    if (signedOut) throw SyncFailure(SyncFailureKind.signedOut, 'sign in again');
    if (down) throw SyncFailure(SyncFailureKind.offline, 'no network');
    String? fault;
    if (faultRate > 0 && _random.nextDouble() < faultRate) fault = ['offline', '503', 'lost'][_random.nextInt(3)];
    if (fault != null) faults.add(fault);
    if (fault == 'offline') throw SyncFailure(SyncFailureKind.offline, 'connection reset');
    if (fault == '503') throw SyncFailure(SyncFailureKind.server, 'server answered 503', retryAfter: const Duration(seconds: 2));
    batchesSeen++;
    final order = [...ops]..sort((a, b) => a.at.compareTo(b.at));
    for (final op in order) {
      if (_outcomes.containsKey(op.opId)) continue;
      _outcomes[op.opId] = _apply(op);
    }
    final answers = ops.map((op) {
      final first = _outcomes[op.opId]!;
      final replay = first.status != 'fresh' && first.original == 'seen';
      return replay ? OpOutcome(opId: op.opId, status: 'duplicate', original: first.status, code: first.code, message: first.message, result: first.result) : first;
    }).toList();
    for (final op in ops) {
      final o = _outcomes[op.opId]!;
      _outcomes[op.opId] = OpOutcome(opId: o.opId, status: o.status, original: 'seen', code: o.code, message: o.message, result: o.result);
    }
    if (fault == 'lost') throw SyncFailure(SyncFailureKind.offline, 'applied, but the answer was lost');
    return answers;
  }

  OpOutcome _apply(Op op) {
    if (!OpTypes.all.contains(op.type)) return OpOutcome(opId: op.opId, status: 'rejected', code: 'unknown_type', message: 'unknown type');
    final sku = op.payload['sku'] as String?;
    if (sku == 'NOPE') return OpOutcome(opId: op.opId, status: 'rejected', code: 'unknown_item', message: 'no item with this SKU');
    final qty = op.payload['quantity'] as int? ?? 0;
    if (op.type == OpTypes.stockCount && qty < (reserved[sku] ?? 0)) {
      return OpOutcome(opId: op.opId, status: 'conflict', code: 'below_reserved', message: 'confirmed orders hold ${reserved[sku]}');
    }
    appliedOrder.add(op.opId);
    return OpOutcome(opId: op.opId, status: 'applied', result: {'onHand': qty});
  }
}
