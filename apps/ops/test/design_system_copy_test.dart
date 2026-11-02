import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

/// The theme and fonts are copies of packages/design-system (Flutter assets must live inside the
/// app). They must match the source: rebuild the design system, then copy again
/// (`cp packages/design-system/dist/mizan_tokens.dart apps/ops/lib/theme/` and the TTFs to assets/fonts).
void main() {
  final root = Directory('../../packages/design-system');
  final present = root.existsSync();

  test('lib/theme/mizan_tokens.dart is the design system\'s current Dart output', () {
    expect(File('lib/theme/mizan_tokens.dart').readAsStringSync(), File('${root.path}/dist/mizan_tokens.dart').readAsStringSync());
  }, skip: present ? false : 'outside the monorepo');

  test('assets/fonts holds the design system\'s fonts, unchanged', () {
    final source = Directory('${root.path}/fonts/ttf').listSync().whereType<File>().where((f) => f.path.endsWith('.ttf')).toList();
    expect(source, isNotEmpty);
    for (final f in source) {
      final name = f.uri.pathSegments.last;
      expect(File('assets/fonts/$name').readAsBytesSync(), f.readAsBytesSync(), reason: name);
    }
  }, skip: present ? false : 'outside the monorepo');
}
