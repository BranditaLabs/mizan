import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:uuid/uuid.dart';

import '../l10n/app_localizations.dart';
import '../sync/op_store.dart';
import '../sync/sync_engine.dart';
import '../theme/mizan_tokens.dart';
import 'pack_session.dart';
import 'pick_list.dart';

/// Where camera scans come from: the real camera on a phone, nothing in tests (the typed code
/// field covers both). Calls [onCode] with each barcode read.
typedef ScannerBuilder = Widget Function(BuildContext context, void Function(String code) onCode);

/// Packing one order (E8-4c): each scan is checked on the spot — a wrong item is blocked with a
/// buzz and a red message, never counted — and "Box packed" appears only when everything is in.
/// The box is then saved as one `order.pack` op and synced like every op (exactly once).
class PackScreen extends StatefulWidget {
  const PackScreen({super.key, required this.order, required this.store, this.engine, this.scanner, DateTime Function()? now}) : now = now ?? DateTime.now;

  final PickOrder order;
  final OpStore store;
  final SyncEngine? engine;
  final ScannerBuilder? scanner;
  final DateTime Function() now;

  @override
  State<PackScreen> createState() => _PackScreenState();
}

enum _Feedback { none, counted, wrong, tooMany }

class _PackScreenState extends State<PackScreen> {
  late final PackSession _session = PackSession(widget.order);
  final _code = TextEditingController();
  _Feedback _feedback = _Feedback.none;
  String _title = '';
  String _last = '';
  DateTime _lastAt = DateTime.fromMillisecondsSinceEpoch(0);

  @override
  void dispose() {
    _code.dispose();
    super.dispose();
  }

  void _scan(String code, {bool manual = false}) {
    // The camera reads the same barcode many times a second: one item per second per code.
    final now = DateTime.now();
    if (!manual && code == _last && now.difference(_lastAt) < const Duration(seconds: 1)) return;
    _last = code;
    _lastAt = now;
    final line = _session.lineFor(code);
    final r = _session.scan(code, manual: manual);
    if (r == ScanResult.wrongItem || r == ScanResult.tooMany) HapticFeedback.heavyImpact();
    setState(() {
      _title = line?.title ?? code;
      _feedback = switch (r) {
        ScanResult.counted => _Feedback.counted,
        ScanResult.wrongItem => _Feedback.wrong,
        ScanResult.tooMany => _Feedback.tooMany,
      };
    });
  }

  Future<void> _finish() async {
    final t = AppLocalizations.of(context);
    final messenger = ScaffoldMessenger.of(context);
    final navigator = Navigator.of(context);
    await widget.store.enqueue(_session.toOp(opId: const Uuid().v4(), at: widget.now()));
    messenger.showSnackBar(SnackBar(content: Text(t.packSaved('\u2066${widget.order.number}\u2069'))));
    navigator.pop(true);
    if (widget.engine != null) await widget.engine!.run();
  }

  @override
  Widget build(BuildContext context) {
    final t = AppLocalizations.of(context);
    final scheme = Theme.of(context).colorScheme;
    final light = Theme.of(context).brightness == Brightness.light;
    final (color, message) = switch (_feedback) {
      _Feedback.none => (scheme.outline, t.scanHint),
      _Feedback.counted => (light ? MizanColorsLight.successText : MizanColorsDark.successText, t.scanCounted(_title)),
      _Feedback.wrong => (scheme.error, t.scanWrong),
      _Feedback.tooMany => (scheme.error, t.scanTooMany(_title)),
    };
    return Scaffold(
      appBar: AppBar(title: Text(t.packTitle('\u2066${widget.order.number}\u2069'))),
      body: ListView(
        padding: const EdgeInsets.all(MizanSpace.s4),
        children: [
          if (widget.scanner != null)
            ClipRRect(borderRadius: BorderRadius.circular(MizanRadius.md), child: SizedBox(height: 220, child: widget.scanner!(context, _scan))),
          const SizedBox(height: MizanSpace.s3),
          Text(message, key: const Key('feedback'), style: MizanType.headingSm.copyWith(color: color)),
          const SizedBox(height: MizanSpace.s3),
          Row(children: [
            Expanded(
              child: TextField(
                key: const Key('typed-code'), controller: _code, textDirection: TextDirection.ltr,
                decoration: InputDecoration(labelText: t.typeCode),
                onSubmitted: (v) { _scan(v, manual: true); _code.clear(); },
              ),
            ),
            const SizedBox(width: MizanSpace.s2),
            OutlinedButton(key: const Key('add-code'), onPressed: () { _scan(_code.text, manual: true); _code.clear(); }, child: Text(t.add)),
          ]),
          const SizedBox(height: MizanSpace.s4),
          Text(t.progress(_session.totalScanned, _session.totalWanted), key: const Key('progress'), style: MizanType.label),
          for (final l in _session.lines)
            ListTile(
              contentPadding: EdgeInsets.zero,
              title: Text(l.title),
              subtitle: Text('\u2066${l.barcode ?? l.sku ?? ''}\u2069', style: MizanType.mono),
              trailing: Row(mainAxisSize: MainAxisSize.min, children: [
                Text('${_session.scanned(l)} / ${_session.wanted(l)}', style: MizanType.label),
                IconButton(tooltip: t.removeOne, onPressed: _session.scanned(l) == 0 ? null : () => setState(() => _session.undo(l)), icon: const Icon(Icons.remove_circle_outline)),
              ]),
            ),
          const SizedBox(height: MizanSpace.s4),
          FilledButton(key: const Key('finish'), onPressed: _session.complete ? _finish : null, child: Text(t.finishPack)),
        ],
      ),
    );
  }
}
