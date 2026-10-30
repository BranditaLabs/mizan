import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';

import 'app/ops_db.dart';
import 'app/queue_screen.dart';
import 'l10n/app_localizations.dart';
import 'sync/op_store.dart';
import 'sync/sync_engine.dart';
import 'theme/mizan_tokens.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  runApp(MizanOpsApp(store: await openOpStore()));
}

/// Mizan's ops app (M4, ADR-0005): Arabic first (right to left), English too; the Brandita theme.
class MizanOpsApp extends StatelessWidget {
  const MizanOpsApp({super.key, required this.store, this.engine, this.locale});

  final OpStore store;
  final SyncEngine? engine;

  /// Null: the phone's language when it is Arabic or English, else Arabic.
  final Locale? locale;

  @override
  Widget build(BuildContext context) => MaterialApp(
        onGenerateTitle: (c) => AppLocalizations.of(c).appTitle,
        theme: mizanLightTheme,
        darkTheme: mizanDarkTheme,
        locale: locale,
        supportedLocales: AppLocalizations.supportedLocales,
        localizationsDelegates: const [AppLocalizations.delegate, GlobalMaterialLocalizations.delegate, GlobalWidgetsLocalizations.delegate, GlobalCupertinoLocalizations.delegate],
        localeResolutionCallback: (device, supported) => supported.firstWhere((l) => l.languageCode == device?.languageCode, orElse: () => const Locale('ar')),
        home: QueueScreen(store: store, engine: engine),
      );
}
