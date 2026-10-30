import 'dart:convert';

import 'package:drift/drift.dart';

import 'op.dart';

part 'op_store.g.dart';

/// The phone's queue (drift / SQLite): every operation until the server has decided it, and
/// afterwards for the user to see what happened. Survives app restarts and phone reboots.
@DataClassName('OpRow')
class Ops extends Table {
  TextColumn get opId => text()();
  TextColumn get type => text()();
  TextColumn get payload => text()();
  DateTimeColumn get at => dateTime()();
  TextColumn get status => textEnum<OpStatus>()();
  IntColumn get attempts => integer().withDefault(const Constant(0))();
  TextColumn get code => text().nullable()();
  TextColumn get message => text().nullable()();
  TextColumn get result => text().nullable()();
  DateTimeColumn get syncedAt => dateTime().nullable()();

  @override
  Set<Column> get primaryKey => {opId};
}

/// Pick lists as last fetched (E8-4c): the warehouse picks and packs from them offline.
@DataClassName('PickListRow')
class PickLists extends Table {
  TextColumn get id => text()();
  IntColumn get number => integer()();
  TextColumn get json => text()();
  DateTimeColumn get fetchedAt => dateTime()();

  @override
  Set<Column> get primaryKey => {id};
}

@DriftDatabase(tables: [Ops, PickLists])
class OpStore extends _$OpStore {
  OpStore(super.e);

  @override
  int get schemaVersion => 2;

  @override
  MigrationStrategy get migration => MigrationStrategy(
        onUpgrade: (m, from, to) async {
          if (from < 2) await m.createTable(pickLists); // E8-4c
        },
      );

  /// Replace the cached open lists with the ones just fetched (a closed list drops out).
  Future<void> savePickLists(List<Map<String, Object?>> lists, DateTime now) => transaction(() async {
        await delete(pickLists).go();
        for (final l in lists) {
          await into(pickLists).insert(PickListsCompanion.insert(id: l['id'] as String, number: (l['number'] as num).toInt(), json: jsonEncode(l), fetchedAt: now.toUtc()));
        }
      });

  /// The cached lists, newest number first, with when they were fetched.
  Future<List<(Map<String, Object?>, DateTime)>> cachedPickLists() async {
    final rows = await (select(pickLists)..orderBy([(p) => OrderingTerm.desc(p.number)])).get();
    return [for (final r in rows) ((jsonDecode(r.json) as Map).cast<String, Object?>(), r.fetchedAt.toUtc())];
  }

  /// Orders packed on this phone and not refused (pending or applied): shown packed before the next fetch.
  Future<Set<String>> packedOrderIds() async {
    final rows = await (select(ops)..where((o) => o.type.equals(OpTypes.orderPack) & o.status.isIn([OpStatus.pending.name, OpStatus.applied.name]))).get();
    return {for (final r in rows) (jsonDecode(r.payload) as Map)['orderId'] as String};
  }

  /// Queue an operation (safe to call twice with the same opId: the first one stays).
  Future<void> enqueue(Op op) => into(ops).insert(
        OpsCompanion.insert(opId: op.opId, type: op.type, payload: op.payloadJson, at: op.at.toUtc(), status: OpStatus.pending),
        mode: InsertMode.insertOrIgnore,
      );

  /// The oldest pending operations, in the order they happened.
  Future<List<Op>> pending({int limit = 200}) async {
    final rows = await (select(ops)
          ..where((o) => o.status.equalsValue(OpStatus.pending))
          ..orderBy([(o) => OrderingTerm.asc(o.at), (o) => OrderingTerm.asc(o.opId)])
          ..limit(limit))
        .get();
    return rows.map(_toOp).toList();
  }

  /// A batch was sent but no answer came: count the attempt; the ops stay pending.
  Future<void> markAttempt(Iterable<String> opIds) async {
    await (update(ops)..where((o) => o.opId.isIn(opIds))).write(OpsCompanion.custom(attempts: ops.attempts + const Constant(1)));
  }

  /// Record the server's answers in one transaction. An answer the app doesn't know keeps the op pending.
  Future<void> record(List<OpOutcome> outcomes, DateTime now) => transaction(() async {
        for (final o in outcomes) {
          final status = o.finalStatus;
          if (status == null) continue;
          await (update(ops)..where((r) => r.opId.equals(o.opId))).write(OpsCompanion(
            status: Value(status),
            code: Value(o.code),
            message: Value(o.message),
            result: Value(o.result == null ? null : jsonEncode(o.result)),
            syncedAt: Value(now.toUtc()),
            attempts: Value.absent(),
          ));
        }
      });

  Future<int> countWhere(OpStatus status) async {
    final c = ops.opId.count();
    final q = selectOnly(ops)
      ..addColumns([c])
      ..where(ops.status.equalsValue(status));
    return (await q.getSingle()).read(c) ?? 0;
  }

  /// What the user sees: the latest operations, newest first.
  Future<List<Op>> recent({int limit = 50}) async {
    final rows = await (select(ops)
          ..orderBy([(o) => OrderingTerm.desc(o.at)])
          ..limit(limit))
        .get();
    return rows.map(_toOp).toList();
  }

  Stream<int> watchPendingCount() {
    final c = ops.opId.count();
    final q = selectOnly(ops)
      ..addColumns([c])
      ..where(ops.status.equalsValue(OpStatus.pending));
    return q.watchSingle().map((r) => r.read(c) ?? 0);
  }

  Op _toOp(OpRow r) => Op(
        opId: r.opId,
        type: r.type,
        payload: (jsonDecode(r.payload) as Map).cast<String, Object?>(),
        at: r.at.toUtc(),
        status: r.status,
        attempts: r.attempts,
        code: r.code,
        message: r.message,
        result: r.result == null ? null : (jsonDecode(r.result!) as Map).cast<String, Object?>(),
        syncedAt: r.syncedAt?.toUtc(),
      );
}
