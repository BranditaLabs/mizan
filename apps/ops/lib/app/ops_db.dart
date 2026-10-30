import 'dart:io';

import 'package:drift/native.dart';
import 'package:path/path.dart' as p;
import 'package:path_provider/path_provider.dart';

import '../sync/op_store.dart';

/// The queue's file in the app's private documents folder (kept across restarts, removed with the app).
Future<OpStore> openOpStore() async {
  final dir = await getApplicationDocumentsDirectory();
  return OpStore(NativeDatabase.createInBackground(File(p.join(dir.path, 'mizan_ops.sqlite'))));
}
