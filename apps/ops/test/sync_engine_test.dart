import 'dart:math';

import 'package:drift/native.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mizan_ops/sync/op.dart';
import 'package:mizan_ops/sync/op_store.dart';
import 'package:mizan_ops/sync/sync_api.dart';
import 'package:mizan_ops/sync/sync_engine.dart';
import 'package:uuid/uuid.dart';

import 'fake_server.dart';

/// E8-4 (offline sync first, ADR-0005): operations queued on the phone reach Mizan exactly once,
/// whatever the network does, in the order they happened; the user sees what Mizan decided.
void main() {
  late OpStore store;
  late FakeOpsServer server;
  late SyncEngine engine;
  final uuid = const Uuid();
  var t = DateTime.utc(2026, 10, 30, 8);

  Op count(String sku, int qty) {
    t = t.add(const Duration(seconds: 1));
    return Op(opId: uuid.v4(), type: OpTypes.stockCount, payload: {'sku': sku, 'quantity': qty}, at: t);
  }

  setUp(() {
    store = OpStore(NativeDatabase.memory());
    server = FakeOpsServer();
    engine = SyncEngine(store: store, api: server, deviceId: 'phone-1', now: () => t);
  });
  tearDown(() => store.close());

  test('offline: ops wait on the phone, then go once the network is back', () async {
    final a = count('AB-1', 5);
    final b = count('AB-2', 3);
    await store.enqueue(a);
    await store.enqueue(b);
    await store.enqueue(a); // the same op queued twice stays one op
    server.down = true;
    final r1 = await engine.run();
    expect(r1.failure?.kind, SyncFailureKind.offline);
    expect(await store.countWhere(OpStatus.pending), 2);
    expect((await store.pending()).every((o) => o.attempts == 1), isTrue);
    server.down = false;
    final r2 = await engine.run();
    expect(r2.complete, isTrue);
    expect(r2.applied, 2);
    expect(server.appliedOrder, [a.opId, b.opId]);
    expect(engine.failures, 0);
  });

  test('a lost answer: the same opIds go again and the server does not apply them twice', () async {
    final ops = [count('AB-1', 5), count('AB-2', 3)];
    for (final o in ops) {
      await store.enqueue(o);
    }
    final lost = FakeOpsServer();
    // A server that applies then loses the answer once.
    var first = true;
    final flaky = _Wrap((deviceId, batch) async {
      final answers = await lost.sync(deviceId, batch);
      if (first) {
        first = false;
        throw SyncFailure(SyncFailureKind.offline, 'answer lost');
      }
      return answers;
    });
    final e = SyncEngine(store: store, api: flaky, deviceId: 'phone-1', now: () => t);
    expect((await e.run()).complete, isFalse);
    expect(await store.countWhere(OpStatus.pending), 2);
    final r = await e.run();
    expect(r.complete, isTrue);
    expect(r.applied, 2); // duplicates of applied ops count as applied
    for (final o in ops) {
      expect(lost.timesApplied(o.opId), 1);
    }
  });

  test('rejected and conflict are kept with why, for the user', () async {
    server.reserved['AB-9'] = 4;
    final bad = count('NOPE', 1);
    final under = count('AB-9', 2);
    final ok = count('AB-1', 7);
    for (final o in [bad, under, ok]) {
      await store.enqueue(o);
    }
    final r = await engine.run();
    expect([r.applied, r.rejected, r.conflicts], [1, 1, 1]);
    final byId = {for (final o in await store.recent()) o.opId: o};
    expect(byId[bad.opId]!.status, OpStatus.rejected);
    expect(byId[bad.opId]!.code, 'unknown_item');
    expect(byId[under.opId]!.status, OpStatus.conflict);
    expect(byId[under.opId]!.message, contains('4'));
    expect(byId[ok.opId]!.result, {'onHand': 7});
  });

  test('more than 200 ops go in batches, oldest first', () async {
    final ops = [for (var i = 0; i < 450; i++) count('AB-$i', i)];
    for (final o in ops.reversed) {
      await store.enqueue(o);
    }
    final r = await engine.run();
    expect(r.applied, 450);
    expect(server.batchesSeen, 3);
    expect(server.appliedOrder, ops.map((o) => o.opId).toList());
  });

  test('signed out: stop and keep everything until the user signs in', () async {
    await store.enqueue(count('AB-1', 1));
    server.signedOut = true;
    final r = await engine.run();
    expect(r.failure?.kind, SyncFailureKind.signedOut);
    expect(await store.countWhere(OpStatus.pending), 1);
  });

  test('one run at a time: a second call joins the first', () async {
    await store.enqueue(count('AB-1', 1));
    final a = engine.run();
    final b = engine.run();
    expect(identical(await a, await b), isTrue);
    expect(server.calls, 1);
  });

  test('the wait grows with failures, with jitter, and follows Retry-After', () async {
    final e = SyncEngine(store: store, api: server, deviceId: 'p', random: Random(3));
    expect(e.nextDelay(SyncFailure(SyncFailureKind.server, 'x', retryAfter: const Duration(seconds: 9))), const Duration(seconds: 9));
    expect(e.nextDelay().inMilliseconds, inInclusiveRange(2500, 5000));
  });

  for (final rate in [0.1, 0.25, 0.5]) {
    test('chaos at $rate: 300 ops, each applied exactly once, in order, nothing left pending', () async {
      server = FakeOpsServer(random: Random((rate * 100).round()));
      server.faultRate = rate;
      engine = SyncEngine(store: store, api: server, deviceId: 'phone-1', now: () => t);
      final ops = <Op>[];
      for (var round = 0; round < 30; round++) {
        for (var i = 0; i < 10; i++) {
          final o = count('SKU-$round-$i', i + 1);
          ops.add(o);
          await store.enqueue(o);
        }
        await engine.run(); // a run per round: some fail, the queue carries over
      }
      for (var i = 0; i < 200 && (await store.countWhere(OpStatus.pending)) > 0; i++) {
        await engine.run();
      }
      expect(server.faults, isNotEmpty);
      expect(await store.countWhere(OpStatus.pending), 0);
      expect(await store.countWhere(OpStatus.applied), 300);
      for (final o in ops) {
        expect(server.timesApplied(o.opId), 1);
      }
      expect(server.appliedOrder, ops.map((o) => o.opId).toList());
    });
  }
}

class _Wrap implements SyncApi {
  _Wrap(this.fn);
  final Future<List<OpOutcome>> Function(String, List<Op>) fn;
  @override
  Future<List<OpOutcome>> sync(String deviceId, List<Op> ops) => fn(deviceId, ops);
}
