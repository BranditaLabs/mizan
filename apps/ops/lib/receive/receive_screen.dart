import 'dart:math' show max;

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:intl/intl.dart' hide TextDirection;
import 'package:uuid/uuid.dart';

import '../l10n/app_localizations.dart';
import '../motion/event_glyph.dart';
import '../motion/event_snack.dart';
import '../motion/fill_bar.dart';
import '../motion/mizan_loader.dart';
import '../motion/motion.dart';
import '../motion/vessels_count.dart';
import '../pick/pack_screen.dart' show ScannerBuilder;
import '../sync/op.dart';
import '../sync/op_store.dart';
import '../sync/sync_api.dart';
import '../sync/sync_engine.dart';
import '../theme/mizan_tokens.dart';
import 'purchase_order.dart';
import 'receive_api.dart';
import 'receive_session.dart';

/// Purchase orders to receive (M16-3), kept on the phone: they open with no connection; Refresh
/// sends what was received offline, then fetches the open ones.
class ReceivePosScreen extends StatefulWidget {
  const ReceivePosScreen({super.key, required this.store, this.api, this.engine, this.scanner, DateTime Function()? now}) : now = now ?? DateTime.now;

  final OpStore store;

  /// Null until someone is signed in: only the cached POs.
  final ReceiveApi? api;
  final SyncEngine? engine;
  final ScannerBuilder? scanner;
  final DateTime Function() now;

  @override
  State<ReceivePosScreen> createState() => _ReceivePosScreenState();
}

class _ReceivePosScreenState extends State<ReceivePosScreen> {
  List<(PurchaseOrder, DateTime, Map<String, int>)> _pos = const [];

  /// What the refresh is doing: sending the phone's queue (ops.syncing), then reading the purchase
  /// orders (ops.loading); null at rest.
  String? _busy;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final cached = await widget.store.cachedPurchaseOrders();
    final out = <(PurchaseOrder, DateTime, Map<String, int>)>[];
    for (final (j, at) in cached) {
      final po = PurchaseOrder.fromJson(j);
      out.add((po, at, await widget.store.receivedHere(po.id, at)));
    }
    if (mounted) setState(() => _pos = out);
  }

  Future<void> _refresh() async {
    final t = AppLocalizations.of(context);
    setState(() => _busy = widget.engine == null ? 'ops.loading' : 'ops.syncing');
    try {
      await widget.engine?.run();
      if (mounted) setState(() => _busy = 'ops.loading');
      final ids = await widget.api!.openPoIds();
      final pos = <Map<String, Object?>>[for (final id in ids) await widget.api!.po(id)];
      await widget.store.savePurchaseOrders(pos, widget.now());
    } on SyncFailure catch (f) {
      if (mounted) {
        showEventSnack(
          context,
          'ops.sync_failed',
          f.kind == SyncFailureKind.offline
              ? t.syncFailedOffline
              : f.kind == SyncFailureKind.signedOut
              ? t.receiveSignIn
              : t.syncFailedServer,
        );
      }
    } finally {
      if (mounted) setState(() => _busy = null);
    }
    await _load();
  }

  /// A delivery saved on the phone: send it (TRANSFER), then this op's own answer:
  /// stock.received (done) only once Mizan applied *this* delivery, ops.op_conflict (tip) or
  /// ops.op_rejected (fail) when Mizan refused it, ops.sync_failed when the run stopped before it.
  Future<void> _syncSaved(PurchaseOrder po, String opId) async {
    final engine = widget.engine;
    if (engine == null || !mounted) return;
    final t = AppLocalizations.of(context);
    setState(() => _busy = 'ops.syncing');
    final report = await engine.run();
    final op = await widget.store.byId(opId);
    if (!mounted) return;
    setState(() => _busy = null);
    final f = report.failure;
    final number = '\u2066${po.number}\u2069';
    final (String, String)? outcome = switch (op?.status) {
      OpStatus.applied => ('stock.received', t.deliverySynced(number)),
      OpStatus.conflict => ('ops.op_conflict', t.deliveryConflict(number, op?.message ?? '')),
      OpStatus.rejected => ('ops.op_rejected', t.deliveryRejected(number, op?.message ?? '')),
      _ when f != null => ('ops.sync_failed', f.kind == SyncFailureKind.offline ? t.syncFailedOffline : f.kind == SyncFailureKind.signedOut ? t.receiveSignIn : t.syncFailedServer),
      _ => null,
    };
    // An outcome replaces "saved on the phone" at once; with none, the saved toast stays.
    if (outcome == null) return;
    ScaffoldMessenger.of(context).clearSnackBars();
    showEventSnack(context, outcome.$1, outcome.$2);
  }

  @override
  Widget build(BuildContext context) {
    final t = AppLocalizations.of(context);
    final scheme = Theme.of(context).colorScheme;
    final time = DateFormat.Hm(Localizations.localeOf(context).toLanguageTag());
    return Scaffold(
      appBar: AppBar(
        title: Text(t.receiveTitle),
        actions: [
          // Sending the queue (transfer), then reading the purchase orders (pair), in the refresh button's place.
          if (widget.api != null || _busy != null)
            _busy != null
                ? Padding(
                    padding: const EdgeInsetsDirectional.only(end: MizanSpace.s4),
                    child: Center(child: EventLoader(_busy!, key: ValueKey('busy-$_busy'), height: 20, label: _busy == 'ops.syncing' ? t.syncing : t.loading)),
                  )
                : IconButton(key: const Key('refresh-pos'), tooltip: t.refresh, onPressed: _refresh, icon: const Icon(Icons.refresh)),
        ],
      ),
      body: ListView(
        padding: const EdgeInsets.all(MizanSpace.s4),
        children: [
          if (widget.api == null) Text(t.receiveSignIn, style: MizanType.bodySm.copyWith(color: scheme.outline)),
          if (_pos.isEmpty)
            Padding(
              padding: const EdgeInsets.only(top: MizanSpace.s3),
              child: Text(t.noPurchaseOrders, style: MizanType.body.copyWith(color: scheme.outline)),
            ),
          for (final (po, at, here) in _pos)
            Card(
              child: ListTile(
                key: Key('po-${po.id}'),
                title: Text('\u2066${po.number}\u2069 · ${po.supplier}', style: MizanType.headingSm),
                subtitle: Text('${t.stillExpected(max(0, po.left - here.values.fold(0, (a, b) => a + b)))} · ${t.fetchedAt(time.format(at.toLocal()))}'),
                onTap: () async {
                  final opId = await Navigator.of(context).push(
                    MaterialPageRoute<String>(
                      builder: (_) => ReceiveScreen(po: po, alreadyHere: here, store: widget.store, engine: widget.engine, scanner: widget.scanner, now: widget.now),
                    ),
                  );
                  if (opId != null) await _syncSaved(po, opId);
                  await _load();
                },
              ),
            ),
        ],
      ),
    );
  }
}

enum _Feedback { none, counted, wrong, tooMany }

/// Receiving one delivery (M16-3): scan items off the delivery; a wrong one or more than ordered is
/// blocked with a buzz; damaged ones are counted apart. Saved as one `po.receive` op, synced once.
class ReceiveScreen extends StatefulWidget {
  const ReceiveScreen({super.key, required this.po, this.alreadyHere = const {}, required this.store, this.engine, this.scanner, DateTime Function()? now}) : now = now ?? DateTime.now;

  final PurchaseOrder po;
  final Map<String, int> alreadyHere;
  final OpStore store;
  final SyncEngine? engine;
  final ScannerBuilder? scanner;
  final DateTime Function() now;

  @override
  State<ReceiveScreen> createState() => _ReceiveScreenState();
}

class _ReceiveScreenState extends State<ReceiveScreen> {
  late final ReceiveSession _session = ReceiveSession(widget.po, alreadyHere: widget.alreadyHere);
  final _code = TextEditingController();
  _Feedback _feedback = _Feedback.none;
  bool _damagedMode = false;
  bool _lastDamaged = false;
  String _title = '';
  String _last = '';
  int _scans = 0;
  DateTime _lastAt = DateTime.fromMillisecondsSinceEpoch(0);

  @override
  void dispose() {
    _code.dispose();
    super.dispose();
  }

  void _scan(String code, {bool manual = false}) {
    final now = DateTime.now();
    if (!manual && code == _last && now.difference(_lastAt) < const Duration(seconds: 1)) return;
    _last = code;
    _lastAt = now;
    final line = _session.lineFor(code);
    final r = _session.scan(code, damaged: _damagedMode);
    if (r != ReceiveResult.counted) HapticFeedback.heavyImpact();
    setState(() {
      _scans++;
      _title = line?.title ?? code;
      _lastDamaged = _damagedMode;
      _feedback = switch (r) {
        ReceiveResult.counted => _Feedback.counted,
        ReceiveResult.wrongItem => _Feedback.wrong,
        ReceiveResult.tooMany => _Feedback.tooMany,
      };
    });
  }

  Future<void> _save() async {
    final t = AppLocalizations.of(context);
    final navigator = Navigator.of(context);
    final op = _session.toOp(opId: const Uuid().v4(), at: widget.now());
    await widget.store.enqueue(op);
    // Saved on the phone (ops.queued settles); the list screen sends it and plays stock.received
    // (done) only once Mizan has applied it.
    if (mounted) showEventSnack(context, 'ops.queued', t.deliverySaved('\u2066${widget.po.number}\u2069'));
    // The list screen gets this op's id: its outcome is this delivery's, not the whole run's.
    navigator.pop(op.opId);
  }

  @override
  Widget build(BuildContext context) {
    final t = AppLocalizations.of(context);
    final scheme = Theme.of(context).colorScheme;
    final light = Theme.of(context).brightness == Brightness.light;
    final (color, message) = switch (_feedback) {
      _Feedback.none => (scheme.outline, t.receiveHint),
      _Feedback.counted => (
        _lastDamaged ? (light ? MizanColorsLight.warningText : MizanColorsDark.warningText) : (light ? MizanColorsLight.successText : MizanColorsDark.successText),
        _lastDamaged ? t.receiveDamagedCounted(_title) : t.receiveCounted(_title),
      ),
      _Feedback.wrong => (scheme.error, t.receiveWrong),
      _Feedback.tooMany => (scheme.error, t.receiveTooMany(_title)),
    };
    return Scaffold(
      appBar: AppBar(title: Text(t.receivePoTitle('\u2066${widget.po.number}\u2069'))),
      bottomNavigationBar: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(MizanSpace.s4),
          child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            // Known progress with a real value: counted of expected on the whole delivery.
            FillBar(
              key: const Key('receive-fill'),
              done: widget.po.lines.fold(0, (s, l) => s + _session.counted(l)),
              total: widget.po.lines.fold(0, (s, l) => s + _session.expected(l)),
              label: t.receiveProgress,
              height: 10,
            ),
            const SizedBox(height: MizanSpace.s3),
            FilledButton(key: const Key('save-delivery'), onPressed: _session.hasAny ? _save : null, child: Text(t.saveDelivery)),
          ]),
        ),
      ),
      body: ListView(
        padding: const EdgeInsets.all(MizanSpace.s4),
        children: [
          if (widget.scanner != null)
            ClipRRect(
              borderRadius: BorderRadius.circular(MizanRadius.md),
              child: SizedBox(height: 220, child: widget.scanner!(context, _scan)),
            ),
          const SizedBox(height: MizanSpace.s3),
          Row(
            children: [
              // Each scan plays its outcome once: counted settles, a blocked one tips and holds.
              if (_feedback != _Feedback.none)
                Padding(
                  padding: const EdgeInsetsDirectional.only(end: MizanSpace.s3),
                  child: EventGlyph(motionOf(_feedback == _Feedback.counted ? 'ops.scan_counted' : 'ops.scan_blocked').outcome, key: ValueKey('scan-$_scans'), size: 24),
                ),
              Expanded(
                child: Text(
                  message,
                  key: const Key('feedback'),
                  style: MizanType.headingSm.copyWith(color: color),
                ),
              ),
            ],
          ),
          SwitchListTile(
            key: const Key('damaged-mode'),
            contentPadding: EdgeInsets.zero,
            value: _damagedMode,
            title: Text(t.damagedMode),
            subtitle: Text(t.damagedModeHint),
            onChanged: (v) => setState(() => _damagedMode = v),
          ),
          Row(
            children: [
              Expanded(
                child: TextField(
                  key: const Key('typed-code'),
                  controller: _code,
                  textDirection: TextDirection.ltr,
                  decoration: InputDecoration(labelText: t.typeCode),
                  onSubmitted: (v) {
                    _scan(v, manual: true);
                    _code.clear();
                  },
                ),
              ),
              const SizedBox(width: MizanSpace.s2),
              OutlinedButton(
                key: const Key('add-code'),
                onPressed: () {
                  _scan(_code.text, manual: true);
                  _code.clear();
                },
                child: Text(t.add),
              ),
            ],
          ),
          const SizedBox(height: MizanSpace.s4),
          Text(t.receiveTotals(_session.totalGood, _session.totalDamaged), key: const Key('totals'), style: MizanType.label),

          for (final l in widget.po.lines)
            ListTile(
              key: Key('line-${l.variantId}'),
              contentPadding: EdgeInsets.zero,
              // Ordered against received: the level rises with each scan and joins when they match.
              leading: VesselsCount(expected: _session.expected(l), received: _session.counted(l), label: t.lineReceived(_session.counted(l), _session.expected(l))),
              title: Text(l.title),
              subtitle: Text('\u2066${l.barcode ?? l.sku ?? ''}\u2069${_session.damaged(l) > 0 ? ' · ${t.damagedCount(_session.damaged(l))}' : ''}', style: MizanType.mono),
              trailing: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text('${_session.counted(l)} / ${_session.expected(l)}', style: MizanType.label),
                  IconButton(
                    tooltip: t.removeOne,
                    onPressed: _session.counted(l) == 0 ? null : () => setState(() => _session.undo(l, damaged: _session.good(l) == 0)),
                    icon: const Icon(Icons.remove_circle_outline),
                  ),
                ],
              ),
            ),
        ],
      ),
    );
  }
}
