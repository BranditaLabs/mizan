import 'dart:async';
import 'dart:math';

import 'op.dart';
import 'op_store.dart';
import 'sync_api.dart';

/// What one sync run did.
class SyncReport {
  SyncReport({this.sent = 0, this.applied = 0, this.rejected = 0, this.conflicts = 0, this.failure});
  int sent;
  int applied;
  int rejected;
  int conflicts;

  /// Why it stopped early; null when the queue was emptied.
  SyncFailure? failure;

  bool get complete => failure == null;
}

/// Sends the phone's queue to Mizan (ADR-0005). Ops go in batches of up to 200, oldest first.
/// An answer marks each op applied, rejected or conflict; no answer (offline, a lost response, a
/// 5xx) leaves them pending and the *same* opIds go again later, which the server dedupes, so an
/// op is never applied twice and never lost. Only one run at a time.
class SyncEngine {
  SyncEngine({required this.store, required this.api, required this.deviceId, DateTime Function()? now, Random? random})
      : _now = now ?? DateTime.now,
        _random = random ?? Random();

  final OpStore store;
  final SyncApi api;
  final String deviceId;
  final DateTime Function() _now;
  final Random _random;
  static const batchSize = 200;

  Future<SyncReport>? _running;
  int _failures = 0;

  /// Consecutive failed runs (for the next delay); 0 after a run that emptied the queue.
  int get failures => _failures;

  /// Run now, or join the run already going.
  Future<SyncReport> run() => _running ??= _run().whenComplete(() => _running = null);

  /// How long to wait before the next try after failures: exponential with jitter, at most 5 minutes,
  /// or what the server asked for (Retry-After).
  Duration nextDelay([SyncFailure? f]) {
    if (f?.retryAfter != null) return f!.retryAfter!;
    final base = min(300, 5 * pow(2, max(0, _failures - 1)).toInt());
    return Duration(milliseconds: (base * 1000 * (0.5 + _random.nextDouble() / 2)).round());
  }

  Future<SyncReport> _run() async {
    final report = SyncReport();
    while (true) {
      final batch = await store.pending(limit: batchSize);
      if (batch.isEmpty) {
        _failures = 0;
        return report;
      }
      final List<OpOutcome> outcomes;
      try {
        outcomes = await api.sync(deviceId, batch);
      } on SyncFailure catch (f) {
        await store.markAttempt(batch.map((o) => o.opId));
        _failures++;
        report.failure = f;
        return report;
      }
      report.sent += batch.length;
      await store.record(outcomes, _now());
      for (final o in outcomes) {
        switch (o.finalStatus) {
          case OpStatus.applied:
            report.applied++;
          case OpStatus.rejected:
            report.rejected++;
          case OpStatus.conflict:
            report.conflicts++;
          case OpStatus.pending || null:
            break;
        }
      }
      // An answer that left ops pending (unknown status, an op missing from the answer) would loop: stop here.
      final decided = outcomes.where((o) => o.finalStatus != null).map((o) => o.opId).toSet();
      if (!batch.every((o) => decided.contains(o.opId))) {
        _failures++;
        report.failure = SyncFailure(SyncFailureKind.server, 'the server did not decide every op');
        return report;
      }
    }
  }
}
