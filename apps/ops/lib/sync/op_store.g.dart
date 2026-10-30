// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'op_store.dart';

// ignore_for_file: type=lint
class $OpsTable extends Ops with TableInfo<$OpsTable, OpRow> {
  @override
  final GeneratedDatabase attachedDatabase;
  final String? _alias;
  $OpsTable(this.attachedDatabase, [this._alias]);
  static const VerificationMeta _opIdMeta = const VerificationMeta('opId');
  @override
  late final GeneratedColumn<String> opId = GeneratedColumn<String>(
    'op_id',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _typeMeta = const VerificationMeta('type');
  @override
  late final GeneratedColumn<String> type = GeneratedColumn<String>(
    'type',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _payloadMeta = const VerificationMeta(
    'payload',
  );
  @override
  late final GeneratedColumn<String> payload = GeneratedColumn<String>(
    'payload',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _atMeta = const VerificationMeta('at');
  @override
  late final GeneratedColumn<DateTime> at = GeneratedColumn<DateTime>(
    'at',
    aliasedName,
    false,
    type: DriftSqlType.dateTime,
    requiredDuringInsert: true,
  );
  @override
  late final GeneratedColumnWithTypeConverter<OpStatus, String> status =
      GeneratedColumn<String>(
        'status',
        aliasedName,
        false,
        type: DriftSqlType.string,
        requiredDuringInsert: true,
      ).withConverter<OpStatus>($OpsTable.$converterstatus);
  static const VerificationMeta _attemptsMeta = const VerificationMeta(
    'attempts',
  );
  @override
  late final GeneratedColumn<int> attempts = GeneratedColumn<int>(
    'attempts',
    aliasedName,
    false,
    type: DriftSqlType.int,
    requiredDuringInsert: false,
    defaultValue: const Constant(0),
  );
  static const VerificationMeta _codeMeta = const VerificationMeta('code');
  @override
  late final GeneratedColumn<String> code = GeneratedColumn<String>(
    'code',
    aliasedName,
    true,
    type: DriftSqlType.string,
    requiredDuringInsert: false,
  );
  static const VerificationMeta _messageMeta = const VerificationMeta(
    'message',
  );
  @override
  late final GeneratedColumn<String> message = GeneratedColumn<String>(
    'message',
    aliasedName,
    true,
    type: DriftSqlType.string,
    requiredDuringInsert: false,
  );
  static const VerificationMeta _resultMeta = const VerificationMeta('result');
  @override
  late final GeneratedColumn<String> result = GeneratedColumn<String>(
    'result',
    aliasedName,
    true,
    type: DriftSqlType.string,
    requiredDuringInsert: false,
  );
  static const VerificationMeta _syncedAtMeta = const VerificationMeta(
    'syncedAt',
  );
  @override
  late final GeneratedColumn<DateTime> syncedAt = GeneratedColumn<DateTime>(
    'synced_at',
    aliasedName,
    true,
    type: DriftSqlType.dateTime,
    requiredDuringInsert: false,
  );
  @override
  List<GeneratedColumn> get $columns => [
    opId,
    type,
    payload,
    at,
    status,
    attempts,
    code,
    message,
    result,
    syncedAt,
  ];
  @override
  String get aliasedName => _alias ?? actualTableName;
  @override
  String get actualTableName => $name;
  static const String $name = 'ops';
  @override
  VerificationContext validateIntegrity(
    Insertable<OpRow> instance, {
    bool isInserting = false,
  }) {
    final context = VerificationContext();
    final data = instance.toColumns(true);
    if (data.containsKey('op_id')) {
      context.handle(
        _opIdMeta,
        opId.isAcceptableOrUnknown(data['op_id']!, _opIdMeta),
      );
    } else if (isInserting) {
      context.missing(_opIdMeta);
    }
    if (data.containsKey('type')) {
      context.handle(
        _typeMeta,
        type.isAcceptableOrUnknown(data['type']!, _typeMeta),
      );
    } else if (isInserting) {
      context.missing(_typeMeta);
    }
    if (data.containsKey('payload')) {
      context.handle(
        _payloadMeta,
        payload.isAcceptableOrUnknown(data['payload']!, _payloadMeta),
      );
    } else if (isInserting) {
      context.missing(_payloadMeta);
    }
    if (data.containsKey('at')) {
      context.handle(_atMeta, at.isAcceptableOrUnknown(data['at']!, _atMeta));
    } else if (isInserting) {
      context.missing(_atMeta);
    }
    if (data.containsKey('attempts')) {
      context.handle(
        _attemptsMeta,
        attempts.isAcceptableOrUnknown(data['attempts']!, _attemptsMeta),
      );
    }
    if (data.containsKey('code')) {
      context.handle(
        _codeMeta,
        code.isAcceptableOrUnknown(data['code']!, _codeMeta),
      );
    }
    if (data.containsKey('message')) {
      context.handle(
        _messageMeta,
        message.isAcceptableOrUnknown(data['message']!, _messageMeta),
      );
    }
    if (data.containsKey('result')) {
      context.handle(
        _resultMeta,
        result.isAcceptableOrUnknown(data['result']!, _resultMeta),
      );
    }
    if (data.containsKey('synced_at')) {
      context.handle(
        _syncedAtMeta,
        syncedAt.isAcceptableOrUnknown(data['synced_at']!, _syncedAtMeta),
      );
    }
    return context;
  }

  @override
  Set<GeneratedColumn> get $primaryKey => {opId};
  @override
  OpRow map(Map<String, dynamic> data, {String? tablePrefix}) {
    final effectivePrefix = tablePrefix != null ? '$tablePrefix.' : '';
    return OpRow(
      opId: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}op_id'],
      )!,
      type: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}type'],
      )!,
      payload: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}payload'],
      )!,
      at: attachedDatabase.typeMapping.read(
        DriftSqlType.dateTime,
        data['${effectivePrefix}at'],
      )!,
      status: $OpsTable.$converterstatus.fromSql(
        attachedDatabase.typeMapping.read(
          DriftSqlType.string,
          data['${effectivePrefix}status'],
        )!,
      ),
      attempts: attachedDatabase.typeMapping.read(
        DriftSqlType.int,
        data['${effectivePrefix}attempts'],
      )!,
      code: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}code'],
      ),
      message: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}message'],
      ),
      result: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}result'],
      ),
      syncedAt: attachedDatabase.typeMapping.read(
        DriftSqlType.dateTime,
        data['${effectivePrefix}synced_at'],
      ),
    );
  }

  @override
  $OpsTable createAlias(String alias) {
    return $OpsTable(attachedDatabase, alias);
  }

  static JsonTypeConverter2<OpStatus, String, String> $converterstatus =
      const EnumNameConverter<OpStatus>(OpStatus.values);
}

class OpRow extends DataClass implements Insertable<OpRow> {
  final String opId;
  final String type;
  final String payload;
  final DateTime at;
  final OpStatus status;
  final int attempts;
  final String? code;
  final String? message;
  final String? result;
  final DateTime? syncedAt;
  const OpRow({
    required this.opId,
    required this.type,
    required this.payload,
    required this.at,
    required this.status,
    required this.attempts,
    this.code,
    this.message,
    this.result,
    this.syncedAt,
  });
  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    map['op_id'] = Variable<String>(opId);
    map['type'] = Variable<String>(type);
    map['payload'] = Variable<String>(payload);
    map['at'] = Variable<DateTime>(at);
    {
      map['status'] = Variable<String>(
        $OpsTable.$converterstatus.toSql(status),
      );
    }
    map['attempts'] = Variable<int>(attempts);
    if (!nullToAbsent || code != null) {
      map['code'] = Variable<String>(code);
    }
    if (!nullToAbsent || message != null) {
      map['message'] = Variable<String>(message);
    }
    if (!nullToAbsent || result != null) {
      map['result'] = Variable<String>(result);
    }
    if (!nullToAbsent || syncedAt != null) {
      map['synced_at'] = Variable<DateTime>(syncedAt);
    }
    return map;
  }

  OpsCompanion toCompanion(bool nullToAbsent) {
    return OpsCompanion(
      opId: Value(opId),
      type: Value(type),
      payload: Value(payload),
      at: Value(at),
      status: Value(status),
      attempts: Value(attempts),
      code: code == null && nullToAbsent ? const Value.absent() : Value(code),
      message: message == null && nullToAbsent
          ? const Value.absent()
          : Value(message),
      result: result == null && nullToAbsent
          ? const Value.absent()
          : Value(result),
      syncedAt: syncedAt == null && nullToAbsent
          ? const Value.absent()
          : Value(syncedAt),
    );
  }

  factory OpRow.fromJson(
    Map<String, dynamic> json, {
    ValueSerializer? serializer,
  }) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return OpRow(
      opId: serializer.fromJson<String>(json['opId']),
      type: serializer.fromJson<String>(json['type']),
      payload: serializer.fromJson<String>(json['payload']),
      at: serializer.fromJson<DateTime>(json['at']),
      status: $OpsTable.$converterstatus.fromJson(
        serializer.fromJson<String>(json['status']),
      ),
      attempts: serializer.fromJson<int>(json['attempts']),
      code: serializer.fromJson<String?>(json['code']),
      message: serializer.fromJson<String?>(json['message']),
      result: serializer.fromJson<String?>(json['result']),
      syncedAt: serializer.fromJson<DateTime?>(json['syncedAt']),
    );
  }
  @override
  Map<String, dynamic> toJson({ValueSerializer? serializer}) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return <String, dynamic>{
      'opId': serializer.toJson<String>(opId),
      'type': serializer.toJson<String>(type),
      'payload': serializer.toJson<String>(payload),
      'at': serializer.toJson<DateTime>(at),
      'status': serializer.toJson<String>(
        $OpsTable.$converterstatus.toJson(status),
      ),
      'attempts': serializer.toJson<int>(attempts),
      'code': serializer.toJson<String?>(code),
      'message': serializer.toJson<String?>(message),
      'result': serializer.toJson<String?>(result),
      'syncedAt': serializer.toJson<DateTime?>(syncedAt),
    };
  }

  OpRow copyWith({
    String? opId,
    String? type,
    String? payload,
    DateTime? at,
    OpStatus? status,
    int? attempts,
    Value<String?> code = const Value.absent(),
    Value<String?> message = const Value.absent(),
    Value<String?> result = const Value.absent(),
    Value<DateTime?> syncedAt = const Value.absent(),
  }) => OpRow(
    opId: opId ?? this.opId,
    type: type ?? this.type,
    payload: payload ?? this.payload,
    at: at ?? this.at,
    status: status ?? this.status,
    attempts: attempts ?? this.attempts,
    code: code.present ? code.value : this.code,
    message: message.present ? message.value : this.message,
    result: result.present ? result.value : this.result,
    syncedAt: syncedAt.present ? syncedAt.value : this.syncedAt,
  );
  OpRow copyWithCompanion(OpsCompanion data) {
    return OpRow(
      opId: data.opId.present ? data.opId.value : this.opId,
      type: data.type.present ? data.type.value : this.type,
      payload: data.payload.present ? data.payload.value : this.payload,
      at: data.at.present ? data.at.value : this.at,
      status: data.status.present ? data.status.value : this.status,
      attempts: data.attempts.present ? data.attempts.value : this.attempts,
      code: data.code.present ? data.code.value : this.code,
      message: data.message.present ? data.message.value : this.message,
      result: data.result.present ? data.result.value : this.result,
      syncedAt: data.syncedAt.present ? data.syncedAt.value : this.syncedAt,
    );
  }

  @override
  String toString() {
    return (StringBuffer('OpRow(')
          ..write('opId: $opId, ')
          ..write('type: $type, ')
          ..write('payload: $payload, ')
          ..write('at: $at, ')
          ..write('status: $status, ')
          ..write('attempts: $attempts, ')
          ..write('code: $code, ')
          ..write('message: $message, ')
          ..write('result: $result, ')
          ..write('syncedAt: $syncedAt')
          ..write(')'))
        .toString();
  }

  @override
  int get hashCode => Object.hash(
    opId,
    type,
    payload,
    at,
    status,
    attempts,
    code,
    message,
    result,
    syncedAt,
  );
  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      (other is OpRow &&
          other.opId == this.opId &&
          other.type == this.type &&
          other.payload == this.payload &&
          other.at == this.at &&
          other.status == this.status &&
          other.attempts == this.attempts &&
          other.code == this.code &&
          other.message == this.message &&
          other.result == this.result &&
          other.syncedAt == this.syncedAt);
}

class OpsCompanion extends UpdateCompanion<OpRow> {
  final Value<String> opId;
  final Value<String> type;
  final Value<String> payload;
  final Value<DateTime> at;
  final Value<OpStatus> status;
  final Value<int> attempts;
  final Value<String?> code;
  final Value<String?> message;
  final Value<String?> result;
  final Value<DateTime?> syncedAt;
  final Value<int> rowid;
  const OpsCompanion({
    this.opId = const Value.absent(),
    this.type = const Value.absent(),
    this.payload = const Value.absent(),
    this.at = const Value.absent(),
    this.status = const Value.absent(),
    this.attempts = const Value.absent(),
    this.code = const Value.absent(),
    this.message = const Value.absent(),
    this.result = const Value.absent(),
    this.syncedAt = const Value.absent(),
    this.rowid = const Value.absent(),
  });
  OpsCompanion.insert({
    required String opId,
    required String type,
    required String payload,
    required DateTime at,
    required OpStatus status,
    this.attempts = const Value.absent(),
    this.code = const Value.absent(),
    this.message = const Value.absent(),
    this.result = const Value.absent(),
    this.syncedAt = const Value.absent(),
    this.rowid = const Value.absent(),
  }) : opId = Value(opId),
       type = Value(type),
       payload = Value(payload),
       at = Value(at),
       status = Value(status);
  static Insertable<OpRow> custom({
    Expression<String>? opId,
    Expression<String>? type,
    Expression<String>? payload,
    Expression<DateTime>? at,
    Expression<String>? status,
    Expression<int>? attempts,
    Expression<String>? code,
    Expression<String>? message,
    Expression<String>? result,
    Expression<DateTime>? syncedAt,
    Expression<int>? rowid,
  }) {
    return RawValuesInsertable({
      if (opId != null) 'op_id': opId,
      if (type != null) 'type': type,
      if (payload != null) 'payload': payload,
      if (at != null) 'at': at,
      if (status != null) 'status': status,
      if (attempts != null) 'attempts': attempts,
      if (code != null) 'code': code,
      if (message != null) 'message': message,
      if (result != null) 'result': result,
      if (syncedAt != null) 'synced_at': syncedAt,
      if (rowid != null) 'rowid': rowid,
    });
  }

  OpsCompanion copyWith({
    Value<String>? opId,
    Value<String>? type,
    Value<String>? payload,
    Value<DateTime>? at,
    Value<OpStatus>? status,
    Value<int>? attempts,
    Value<String?>? code,
    Value<String?>? message,
    Value<String?>? result,
    Value<DateTime?>? syncedAt,
    Value<int>? rowid,
  }) {
    return OpsCompanion(
      opId: opId ?? this.opId,
      type: type ?? this.type,
      payload: payload ?? this.payload,
      at: at ?? this.at,
      status: status ?? this.status,
      attempts: attempts ?? this.attempts,
      code: code ?? this.code,
      message: message ?? this.message,
      result: result ?? this.result,
      syncedAt: syncedAt ?? this.syncedAt,
      rowid: rowid ?? this.rowid,
    );
  }

  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    if (opId.present) {
      map['op_id'] = Variable<String>(opId.value);
    }
    if (type.present) {
      map['type'] = Variable<String>(type.value);
    }
    if (payload.present) {
      map['payload'] = Variable<String>(payload.value);
    }
    if (at.present) {
      map['at'] = Variable<DateTime>(at.value);
    }
    if (status.present) {
      map['status'] = Variable<String>(
        $OpsTable.$converterstatus.toSql(status.value),
      );
    }
    if (attempts.present) {
      map['attempts'] = Variable<int>(attempts.value);
    }
    if (code.present) {
      map['code'] = Variable<String>(code.value);
    }
    if (message.present) {
      map['message'] = Variable<String>(message.value);
    }
    if (result.present) {
      map['result'] = Variable<String>(result.value);
    }
    if (syncedAt.present) {
      map['synced_at'] = Variable<DateTime>(syncedAt.value);
    }
    if (rowid.present) {
      map['rowid'] = Variable<int>(rowid.value);
    }
    return map;
  }

  @override
  String toString() {
    return (StringBuffer('OpsCompanion(')
          ..write('opId: $opId, ')
          ..write('type: $type, ')
          ..write('payload: $payload, ')
          ..write('at: $at, ')
          ..write('status: $status, ')
          ..write('attempts: $attempts, ')
          ..write('code: $code, ')
          ..write('message: $message, ')
          ..write('result: $result, ')
          ..write('syncedAt: $syncedAt, ')
          ..write('rowid: $rowid')
          ..write(')'))
        .toString();
  }
}

abstract class _$OpStore extends GeneratedDatabase {
  _$OpStore(QueryExecutor e) : super(e);
  $OpStoreManager get managers => $OpStoreManager(this);
  late final $OpsTable ops = $OpsTable(this);
  @override
  Iterable<TableInfo<Table, Object?>> get allTables =>
      allSchemaEntities.whereType<TableInfo<Table, Object?>>();
  @override
  List<DatabaseSchemaEntity> get allSchemaEntities => [ops];
}

typedef $$OpsTableCreateCompanionBuilder = OpsCompanion Function({
  required String opId,
  required String type,
  required String payload,
  required DateTime at,
  required OpStatus status,
  Value<int> attempts,
  Value<String?> code,
  Value<String?> message,
  Value<String?> result,
  Value<DateTime?> syncedAt,
  Value<int> rowid,
});
typedef $$OpsTableUpdateCompanionBuilder = OpsCompanion Function({
  Value<String> opId,
  Value<String> type,
  Value<String> payload,
  Value<DateTime> at,
  Value<OpStatus> status,
  Value<int> attempts,
  Value<String?> code,
  Value<String?> message,
  Value<String?> result,
  Value<DateTime?> syncedAt,
  Value<int> rowid,
});

class $$OpsTableFilterComposer extends Composer<_$OpStore, $OpsTable> {
  $$OpsTableFilterComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnFilters<String> get opId => $composableBuilder(
    column: $table.opId,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get type => $composableBuilder(
    column: $table.type,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get payload => $composableBuilder(
    column: $table.payload,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<DateTime> get at => $composableBuilder(
    column: $table.at,
    builder: (column) => ColumnFilters(column),
  );

  ColumnWithTypeConverterFilters<OpStatus, OpStatus, String> get status =>
      $composableBuilder(
        column: $table.status,
        builder: (column) => ColumnWithTypeConverterFilters(column),
      );

  ColumnFilters<int> get attempts => $composableBuilder(
    column: $table.attempts,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get code => $composableBuilder(
    column: $table.code,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get message => $composableBuilder(
    column: $table.message,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get result => $composableBuilder(
    column: $table.result,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<DateTime> get syncedAt => $composableBuilder(
    column: $table.syncedAt,
    builder: (column) => ColumnFilters(column),
  );
}

class $$OpsTableOrderingComposer extends Composer<_$OpStore, $OpsTable> {
  $$OpsTableOrderingComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnOrderings<String> get opId => $composableBuilder(
    column: $table.opId,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get type => $composableBuilder(
    column: $table.type,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get payload => $composableBuilder(
    column: $table.payload,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<DateTime> get at => $composableBuilder(
    column: $table.at,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get status => $composableBuilder(
    column: $table.status,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<int> get attempts => $composableBuilder(
    column: $table.attempts,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get code => $composableBuilder(
    column: $table.code,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get message => $composableBuilder(
    column: $table.message,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get result => $composableBuilder(
    column: $table.result,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<DateTime> get syncedAt => $composableBuilder(
    column: $table.syncedAt,
    builder: (column) => ColumnOrderings(column),
  );
}

class $$OpsTableAnnotationComposer extends Composer<_$OpStore, $OpsTable> {
  $$OpsTableAnnotationComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  GeneratedColumn<String> get opId =>
      $composableBuilder(column: $table.opId, builder: (column) => column);

  GeneratedColumn<String> get type =>
      $composableBuilder(column: $table.type, builder: (column) => column);

  GeneratedColumn<String> get payload =>
      $composableBuilder(column: $table.payload, builder: (column) => column);

  GeneratedColumn<DateTime> get at =>
      $composableBuilder(column: $table.at, builder: (column) => column);

  GeneratedColumnWithTypeConverter<OpStatus, String> get status =>
      $composableBuilder(column: $table.status, builder: (column) => column);

  GeneratedColumn<int> get attempts =>
      $composableBuilder(column: $table.attempts, builder: (column) => column);

  GeneratedColumn<String> get code =>
      $composableBuilder(column: $table.code, builder: (column) => column);

  GeneratedColumn<String> get message =>
      $composableBuilder(column: $table.message, builder: (column) => column);

  GeneratedColumn<String> get result =>
      $composableBuilder(column: $table.result, builder: (column) => column);

  GeneratedColumn<DateTime> get syncedAt =>
      $composableBuilder(column: $table.syncedAt, builder: (column) => column);
}

class $$OpsTableTableManager
    extends
        RootTableManager<
          _$OpStore,
          $OpsTable,
          OpRow,
          $$OpsTableFilterComposer,
          $$OpsTableOrderingComposer,
          $$OpsTableAnnotationComposer,
          $$OpsTableCreateCompanionBuilder,
          $$OpsTableUpdateCompanionBuilder,
          (OpRow, BaseReferences<_$OpStore, $OpsTable, OpRow>),
          OpRow,
          PrefetchHooks Function()
        > {
  $$OpsTableTableManager(_$OpStore db, $OpsTable table)
    : super(
        TableManagerState(
          db: db,
          table: table,
          createFilteringComposer: () =>
              $$OpsTableFilterComposer($db: db, $table: table),
          createOrderingComposer: () =>
              $$OpsTableOrderingComposer($db: db, $table: table),
          createComputedFieldComposer: () =>
              $$OpsTableAnnotationComposer($db: db, $table: table),
          updateCompanionCallback:
              ({
                Value<String> opId = const Value.absent(),
                Value<String> type = const Value.absent(),
                Value<String> payload = const Value.absent(),
                Value<DateTime> at = const Value.absent(),
                Value<OpStatus> status = const Value.absent(),
                Value<int> attempts = const Value.absent(),
                Value<String?> code = const Value.absent(),
                Value<String?> message = const Value.absent(),
                Value<String?> result = const Value.absent(),
                Value<DateTime?> syncedAt = const Value.absent(),
                Value<int> rowid = const Value.absent(),
              }) => OpsCompanion(
                opId: opId,
                type: type,
                payload: payload,
                at: at,
                status: status,
                attempts: attempts,
                code: code,
                message: message,
                result: result,
                syncedAt: syncedAt,
                rowid: rowid,
              ),
          createCompanionCallback:
              ({
                required String opId,
                required String type,
                required String payload,
                required DateTime at,
                required OpStatus status,
                Value<int> attempts = const Value.absent(),
                Value<String?> code = const Value.absent(),
                Value<String?> message = const Value.absent(),
                Value<String?> result = const Value.absent(),
                Value<DateTime?> syncedAt = const Value.absent(),
                Value<int> rowid = const Value.absent(),
              }) => OpsCompanion.insert(
                opId: opId,
                type: type,
                payload: payload,
                at: at,
                status: status,
                attempts: attempts,
                code: code,
                message: message,
                result: result,
                syncedAt: syncedAt,
                rowid: rowid,
              ),
          withReferenceMapper: (p0) => p0
              .map(
                (e) => (
                  e.readTable<$OpsTable, OpRow>(table),
                  BaseReferences<_$OpStore, $OpsTable, OpRow>(db, table, e),
                ),
              )
              .toList(),
          prefetchHooksCallback: null,
        ),
      );
}

typedef $$OpsTableProcessedTableManager =
    ProcessedTableManager<
      _$OpStore,
      $OpsTable,
      OpRow,
      $$OpsTableFilterComposer,
      $$OpsTableOrderingComposer,
      $$OpsTableAnnotationComposer,
      $$OpsTableCreateCompanionBuilder,
      $$OpsTableUpdateCompanionBuilder,
      (OpRow, BaseReferences<_$OpStore, $OpsTable, OpRow>),
      OpRow,
      PrefetchHooks Function()
    >;

class $OpStoreManager {
  final _$OpStore _db;
  $OpStoreManager(this._db);
  $$OpsTableTableManager get ops => $$OpsTableTableManager(_db, _db.ops);
}
