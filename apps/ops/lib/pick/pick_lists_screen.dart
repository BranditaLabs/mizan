import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import '../l10n/app_localizations.dart';
import '../motion/event_snack.dart';
import '../motion/fill_bar.dart';
import '../motion/mizan_loader.dart';
import '../sync/op.dart';
import '../sync/op_store.dart';
import '../sync/sync_api.dart';
import '../sync/sync_engine.dart';
import '../theme/mizan_tokens.dart';
import 'pack_screen.dart';
import 'pick_api.dart';
import 'pick_list.dart';

/// The warehouse's pick lists (E8-4c), kept on the phone: they open with no connection; Refresh
/// fetches the open ones when there is one. An order packed here shows packed at once.
class PickListsScreen extends StatefulWidget {
  const PickListsScreen({super.key, required this.store, this.api, this.engine, this.scanner, DateTime Function()? now}) : now = now ?? DateTime.now;

  final OpStore store;

  /// Null until someone is signed in: only the cached lists.
  final PickApi? api;
  final SyncEngine? engine;
  final ScannerBuilder? scanner;
  final DateTime Function() now;

  @override
  State<PickListsScreen> createState() => _PickListsScreenState();
}

class _PickListsScreenState extends State<PickListsScreen> {
  List<(PickList, DateTime)> _lists = const [];
  Set<String> _packedHere = const {};

  /// What the refresh is doing: sending the queue (ops.syncing), then reading lists (ops.loading).
  String? _busy;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final cached = await widget.store.cachedPickLists();
    final packed = await widget.store.packedOrderIds();
    if (!mounted) return;
    setState(() {
      _lists = [for (final (j, at) in cached) (PickList.fromJson(j), at)];
      _packedHere = packed;
    });
  }

  int _packedCount(PickList list) => list.orders.where((o) => o.packed || _packedHere.contains(o.id)).length;

  Future<void> _refresh() async {
    final t = AppLocalizations.of(context);
    setState(() => _busy = widget.engine == null ? 'ops.loading' : 'ops.syncing');
    try {
      // Send what was packed offline first (TRANSFER), so the lists come back up to date (PAIR).
      await widget.engine?.run();
      if (mounted) setState(() => _busy = 'ops.loading');
      final ids = await widget.api!.openListIds();
      final lists = <Map<String, Object?>>[for (final id in ids) await widget.api!.list(id)];
      await widget.store.savePickLists(lists, widget.now());
    } on SyncFailure catch (f) {
      if (mounted) showEventSnack(context, 'ops.sync_failed', f.kind == SyncFailureKind.offline ? t.syncFailedOffline : f.kind == SyncFailureKind.signedOut ? t.pickListsSignIn : t.syncFailedServer);
    } finally {
      if (mounted) setState(() => _busy = null);
    }
    await _load();
  }

  @override
  Widget build(BuildContext context) {
    final t = AppLocalizations.of(context);
    final scheme = Theme.of(context).colorScheme;
    final time = DateFormat.Hm(Localizations.localeOf(context).toLanguageTag());
    return Scaffold(
      appBar: AppBar(title: Text(t.pickListsTitle), actions: [
        // Sending the queue (transfer), then the lists coming in (pair), in the refresh button's place.
        if (widget.api != null)
          _busy != null
              ? Padding(padding: const EdgeInsetsDirectional.only(end: MizanSpace.s4), child: Center(child: EventLoader(_busy!, key: ValueKey('busy-$_busy'), height: 20, label: _busy == 'ops.syncing' ? t.syncing : t.loading)))
              : IconButton(key: const Key('refresh'), tooltip: t.refresh, onPressed: _refresh, icon: const Icon(Icons.refresh)),
      ]),
      body: ListView(
        padding: const EdgeInsets.all(MizanSpace.s4),
        children: [
          if (widget.api == null) Text(t.pickListsSignIn, style: MizanType.bodySm.copyWith(color: scheme.outline)),
          if (_lists.isEmpty) Padding(padding: const EdgeInsets.only(top: MizanSpace.s3), child: Text(t.noPickLists, style: MizanType.body.copyWith(color: scheme.outline))),
          for (final (list, at) in _lists)
            Card(
              child: ListTile(
                key: Key('list-${list.id}'),
                title: Text(t.pickListLabel(list.number), style: MizanType.headingSm),
                subtitle: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Text('${t.pickListSummary(list.orders.length, _packedCount(list))} · ${t.fetchedAt(time.format(at.toLocal()))}'),
                  const SizedBox(height: MizanSpace.s2),
                  // Known progress: orders packed of the list (mono: a list holds many bars).
                  FillBar(done: _packedCount(list), total: list.orders.length, label: t.pickListProgress, mono: true, height: 8),
                ]),
                onTap: () async {
                  await Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => PickListScreen(list: list, store: widget.store, engine: widget.engine, scanner: widget.scanner, now: widget.now)));
                  await _load();
                },
              ),
            ),
        ],
      ),
    );
  }
}

/// One list: what to take from each shelf, then the orders to pack.
class PickListScreen extends StatefulWidget {
  const PickListScreen({super.key, required this.list, required this.store, this.engine, this.scanner, required this.now});

  final PickList list;
  final OpStore store;
  final SyncEngine? engine;
  final ScannerBuilder? scanner;
  final DateTime Function() now;

  @override
  State<PickListScreen> createState() => _PickListScreenState();
}

class _PickListScreenState extends State<PickListScreen> {
  Set<String> _packedHere = const {};
  bool _syncing = false;

  /// A box saved on the phone: send it (TRANSFER), then this op's own answer: order.packed (done)
  /// only once Mizan applied *this* box, ops.op_conflict (tip) or ops.op_rejected (fail) when Mizan
  /// refused it, ops.sync_failed when the run stopped before it (it stays queued and goes later).
  Future<void> _syncSaved(PickOrder o, String opId) async {
    final engine = widget.engine;
    if (engine == null || !mounted) return;
    final t = AppLocalizations.of(context);
    setState(() => _syncing = true);
    final report = await engine.run();
    final op = await widget.store.byId(opId);
    if (!mounted) return;
    setState(() => _syncing = false);
    final f = report.failure;
    final number = '\u2066${o.number}\u2069';
    final (String, String)? outcome = switch (op?.status) {
      OpStatus.applied => ('order.packed', t.packSynced(number)),
      OpStatus.conflict => ('ops.op_conflict', t.packConflict(number, op?.message ?? '')),
      OpStatus.rejected => ('ops.op_rejected', t.packRejected(number, op?.message ?? '')),
      _ when f != null => ('ops.sync_failed', f.kind == SyncFailureKind.offline ? t.syncFailedOffline : f.kind == SyncFailureKind.signedOut ? t.pickListsSignIn : t.syncFailedServer),
      _ => null,
    };
    // An outcome replaces "saved on the phone" at once; with none, the saved toast stays.
    if (outcome == null) return;
    ScaffoldMessenger.of(context).clearSnackBars();
    showEventSnack(context, outcome.$1, outcome.$2);
  }

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final packed = await widget.store.packedOrderIds();
    if (mounted) setState(() => _packedHere = packed);
  }

  @override
  Widget build(BuildContext context) {
    final t = AppLocalizations.of(context);
    final scheme = Theme.of(context).colorScheme;
    return Scaffold(
      appBar: AppBar(title: Text(t.pickListLabel(widget.list.number)), actions: [
        if (_syncing) Padding(padding: const EdgeInsetsDirectional.only(end: MizanSpace.s4), child: Center(child: EventLoader('ops.syncing', key: const Key('pack-syncing'), height: 20, label: t.syncing))),
      ]),
      body: ListView(
        padding: const EdgeInsets.all(MizanSpace.s4),
        children: [
          Text(t.toPick, style: MizanType.headingSm),
          for (final i in widget.list.items)
            ListTile(
              contentPadding: EdgeInsets.zero,
              leading: SizedBox(width: 72, child: Text('\u2066${i.bin ?? t.noShelf}\u2069', style: MizanType.mono)),
              title: Text(i.title),
              subtitle: Text('\u2066${i.sku ?? i.barcode ?? ''}\u2069', style: MizanType.mono.copyWith(color: scheme.outline)),
              trailing: Text('× ${i.quantity}', style: MizanType.kpiSm),
            ),
          const SizedBox(height: MizanSpace.s4),
          Text(t.ordersToPack, style: MizanType.headingSm),
          for (final o in widget.list.orders)
            ListTile(
              key: Key('order-${o.id}'),
              contentPadding: EdgeInsets.zero,
              title: Text('\u2066${o.number}\u2069'),
              subtitle: Text(t.progress(o.packed || _packedHere.contains(o.id) ? o.lines.fold(0, (s, l) => s + l.quantity) : 0, o.lines.fold(0, (s, l) => s + l.quantity))),
              trailing: o.packed || _packedHere.contains(o.id)
                  ? Text(t.packed, style: MizanType.label)
                  : FilledButton(
                      onPressed: () async {
                        final opId = await Navigator.of(context).push(MaterialPageRoute<String>(builder: (_) => PackScreen(order: o, store: widget.store, engine: widget.engine, scanner: widget.scanner, now: widget.now)));
                        await _load();
                        if (opId != null) await _syncSaved(o, opId);
                      },
                      child: Text(t.pack),
                    ),
            ),
        ],
      ),
    );
  }
}
