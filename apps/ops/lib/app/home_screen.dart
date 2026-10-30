import 'package:flutter/material.dart';

import '../l10n/app_localizations.dart';
import '../pick/pack_screen.dart';
import '../pick/pick_api.dart';
import '../pick/pick_lists_screen.dart';
import '../sync/op_store.dart';
import '../sync/sync_engine.dart';
import 'queue_screen.dart';

/// The app's two jobs: counting stock, and picking and packing orders.
class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key, required this.store, this.engine, this.pickApi, this.scanner});

  final OpStore store;
  final SyncEngine? engine;
  final PickApi? pickApi;
  final ScannerBuilder? scanner;

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  int _tab = 0;

  @override
  Widget build(BuildContext context) {
    final t = AppLocalizations.of(context);
    return Scaffold(
      body: IndexedStack(index: _tab, children: [
        QueueScreen(store: widget.store, engine: widget.engine),
        PickListsScreen(store: widget.store, api: widget.pickApi, engine: widget.engine, scanner: widget.scanner),
      ]),
      bottomNavigationBar: NavigationBar(
        selectedIndex: _tab,
        onDestinationSelected: (i) => setState(() => _tab = i),
        destinations: [
          NavigationDestination(key: const Key('tab-count'), icon: const Icon(Icons.inventory_2_outlined), label: t.tabCount),
          NavigationDestination(key: const Key('tab-pick'), icon: const Icon(Icons.qr_code_scanner), label: t.tabPick),
        ],
      ),
    );
  }
}
