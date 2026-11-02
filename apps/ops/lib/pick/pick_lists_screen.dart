import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import '../l10n/app_localizations.dart';
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
  bool _loading = false;

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

  Future<void> _refresh() async {
    final t = AppLocalizations.of(context);
    final messenger = ScaffoldMessenger.of(context);
    setState(() => _loading = true);
    try {
      // Send what was packed offline first, so the lists come back up to date.
      await widget.engine?.run();
      final ids = await widget.api!.openListIds();
      final lists = <Map<String, Object?>>[for (final id in ids) await widget.api!.list(id)];
      await widget.store.savePickLists(lists, widget.now());
    } on SyncFailure catch (f) {
      messenger.showSnackBar(SnackBar(content: Text(f.kind == SyncFailureKind.offline ? t.syncFailedOffline : f.kind == SyncFailureKind.signedOut ? t.pickListsSignIn : t.syncFailedServer)));
    } finally {
      if (mounted) setState(() => _loading = false);
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
        if (widget.api != null) IconButton(key: const Key('refresh'), tooltip: t.refresh, onPressed: _loading ? null : _refresh, icon: const Icon(Icons.refresh)),
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
                subtitle: Text('${t.pickListSummary(list.orders.length, list.orders.where((o) => o.packed || _packedHere.contains(o.id)).length)} · ${t.fetchedAt(time.format(at.toLocal()))}'),
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
      appBar: AppBar(title: Text(t.pickListLabel(widget.list.number))),
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
              subtitle: Text(t.progress(0, o.lines.fold(0, (s, l) => s + l.quantity))),
              trailing: o.packed || _packedHere.contains(o.id)
                  ? Text(t.packed, style: MizanType.label)
                  : FilledButton(
                      onPressed: () async {
                        await Navigator.of(context).push(MaterialPageRoute<bool>(builder: (_) => PackScreen(order: o, store: widget.store, engine: widget.engine, scanner: widget.scanner, now: widget.now)));
                        await _load();
                      },
                      child: Text(t.pack),
                    ),
            ),
        ],
      ),
    );
  }
}
