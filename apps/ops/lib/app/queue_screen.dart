import 'package:flutter/material.dart';
import 'package:uuid/uuid.dart';

import '../l10n/app_localizations.dart';
import '../motion/event_snack.dart';
import '../motion/mizan_loader.dart';
import '../sync/op.dart';
import '../sync/op_store.dart';
import '../sync/sync_api.dart';
import '../sync/sync_engine.dart';
import '../theme/mizan_tokens.dart';

/// The ops app's first screen (E8-4 part 1): count an item — saved on the phone at once, with or
/// without a connection — and see each operation's state as Mizan decides it.
class QueueScreen extends StatefulWidget {
  const QueueScreen({super.key, required this.store, this.engine, DateTime Function()? now}) : now = now ?? DateTime.now;

  final OpStore store;

  /// Null until someone is signed in: operations wait on the phone.
  final SyncEngine? engine;
  final DateTime Function() now;

  @override
  State<QueueScreen> createState() => _QueueScreenState();
}

class _QueueScreenState extends State<QueueScreen> {
  final _form = GlobalKey<FormState>();
  final _code = TextEditingController();
  final _qty = TextEditingController();
  List<Op> _recent = const [];
  bool _syncing = false;

  @override
  void initState() {
    super.initState();
    _reload();
  }

  @override
  void dispose() {
    _code.dispose();
    _qty.dispose();
    super.dispose();
  }

  Future<void> _reload() async {
    final recent = await widget.store.recent();
    if (mounted) setState(() => _recent = recent);
  }

  Future<void> _save() async {
    if (!_form.currentState!.validate()) return;
    final code = _code.text.trim();
    // A code of digits only is a barcode (as scanned); anything else is the item's SKU.
    final key = RegExp(r'^\d{6,14}$').hasMatch(code) ? 'barcode' : 'sku';
    await widget.store.enqueue(Op(opId: const Uuid().v4(), type: OpTypes.stockCount, payload: {key: code, 'quantity': int.parse(_qty.text.trim())}, at: widget.now().toUtc()));
    _code.clear();
    _qty.clear();
    if (!mounted) return;
    // A count saved on the phone: the stock-adjusted motion (it settles; Mizan says later if it matched).
    showEventSnack(context, 'stock.adjusted', AppLocalizations.of(context).saved);
    await _reload();
    if (widget.engine != null) await _sync();
  }

  Future<void> _sync() async {
    final t = AppLocalizations.of(context);
    setState(() => _syncing = true);
    final report = await widget.engine!.run();
    if (!mounted) return;
    setState(() => _syncing = false);
    await _reload();
    final f = report.failure;
    if (f != null && mounted) {
      showEventSnack(context, 'ops.sync_failed', switch (f.kind) {
        SyncFailureKind.offline => t.syncFailedOffline,
        SyncFailureKind.signedOut || SyncFailureKind.forbidden => t.signInToSync,
        _ => t.syncFailedServer,
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final t = AppLocalizations.of(context);
    final scheme = Theme.of(context).colorScheme;
    return Scaffold(
      appBar: AppBar(title: Text(t.queueTitle)),
      body: ListView(
        padding: const EdgeInsets.all(MizanSpace.s4),
        children: [
          StreamBuilder<int>(
            stream: widget.store.watchPendingCount(),
            builder: (context, snap) => Text(t.pending(snap.data ?? 0), style: MizanType.headingSm, key: const Key('pending')),
          ),
          if (widget.engine == null) Padding(padding: const EdgeInsetsDirectional.only(top: MizanSpace.s2), child: Text(t.signInToSync, style: MizanType.bodySm.copyWith(color: scheme.outline))),
          const SizedBox(height: MizanSpace.s4),
          Card(
            child: Padding(
              padding: const EdgeInsets.all(MizanSpace.s4),
              child: Form(
                key: _form,
                child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                  Text(t.countTitle, style: MizanType.headingSm),
                  const SizedBox(height: MizanSpace.s3),
                  TextFormField(
                    key: const Key('code'), controller: _code, textDirection: TextDirection.ltr,
                    decoration: InputDecoration(labelText: t.itemCode, hintText: t.itemCodeHint),
                    validator: (v) => (v ?? '').trim().isEmpty ? t.invalidCode : null,
                  ),
                  const SizedBox(height: MizanSpace.s3),
                  TextFormField(
                    key: const Key('quantity'), controller: _qty, keyboardType: TextInputType.number, textDirection: TextDirection.ltr,
                    decoration: InputDecoration(labelText: t.quantity),
                    validator: (v) => RegExp(r'^\d{1,6}$').hasMatch((v ?? '').trim()) ? null : t.invalidQuantity,
                  ),
                  const SizedBox(height: MizanSpace.s4),
                  FilledButton(key: const Key('save'), onPressed: _save, child: Text(t.save)),
                ]),
              ),
            ),
          ),
          if (widget.engine != null) ...[
            const SizedBox(height: MizanSpace.s3),
            // Syncing is two systems reconciling: the transfer loader, with its words.
            OutlinedButton(
              key: const Key('sync-now'),
              onPressed: _syncing ? null : _sync,
              child: _syncing
                  ? Row(mainAxisSize: MainAxisSize.min, children: [const EventLoader('ops.syncing', height: 16), const SizedBox(width: MizanSpace.s2), Text(t.syncing)])
                  : Text(t.syncNow),
            ),
          ],
          const SizedBox(height: MizanSpace.s5),
          if (_recent.isEmpty) Text(t.nothingYet, style: MizanType.body.copyWith(color: scheme.outline)),
          for (final op in _recent) _OpTile(op: op, syncing: _syncing),
        ],
      ),
    );
  }
}

class _OpTile extends StatelessWidget {
  const _OpTile({required this.op, this.syncing = false});
  final Op op;

  /// A pending op shows the transfer loader while the queue is being sent.
  final bool syncing;

  @override
  Widget build(BuildContext context) {
    final t = AppLocalizations.of(context);
    final code = (op.payload['barcode'] ?? op.payload['sku'] ?? '').toString();
    final status = switch (op.status) {
      OpStatus.pending => t.statusPending,
      OpStatus.applied => t.statusApplied,
      OpStatus.rejected => t.statusRejected,
      OpStatus.conflict => t.statusConflict,
    };
    return ListTile(
      key: Key('op-${op.opId}'),
      contentPadding: EdgeInsets.zero,
      // Codes and numbers read left to right inside Arabic text.
      title: Text(t.opCount('\u2066$code\u2069', op.payload['quantity'] as int? ?? 0)),
      subtitle: op.message == null ? null : Text(op.message!),
      trailing: Row(mainAxisSize: MainAxisSize.min, children: [
        if (syncing && op.status == OpStatus.pending) ...[const EventLoader('ops.syncing', height: 14), const SizedBox(width: MizanSpace.s2)],
        Text(status, style: MizanType.label),
      ]),
    );
  }
}
