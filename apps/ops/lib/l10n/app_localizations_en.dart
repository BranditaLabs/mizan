// ignore: unused_import
import 'package:intl/intl.dart' as intl;

import 'app_localizations.dart';

// ignore_for_file: type=lint

/// The translations for English (`en`).
class AppLocalizationsEn extends AppLocalizations {
  AppLocalizationsEn([String locale = 'en']) : super(locale);

  @override
  String get appTitle => 'Mizan Ops';

  @override
  String get queueTitle => 'Stock on this phone';

  @override
  String pending(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count operations waiting to sync',
      one: '1 operation waiting to sync',
      zero: 'Everything is synced',
    );
    return '$_temp0';
  }

  @override
  String get countTitle => 'Count an item';

  @override
  String get itemCode => 'Barcode or SKU';

  @override
  String get itemCodeHint => 'Scan or type it';

  @override
  String get quantity => 'Quantity on the shelf';

  @override
  String get save => 'Save the count';

  @override
  String get saved =>
      'Saved on the phone. It syncs when there is a connection.';

  @override
  String get invalidQuantity => 'Enter a whole number, 0 or more';

  @override
  String get invalidCode => 'Enter the barcode or SKU';

  @override
  String get syncNow => 'Sync now';

  @override
  String get signInToSync => 'Sign in to sync these with Mizan.';

  @override
  String get syncFailedOffline =>
      'No connection. Saved on the phone; Mizan gets it later.';

  @override
  String get syncFailedServer => 'Mizan is busy. It will try again.';

  @override
  String get synced => 'Synced';

  @override
  String get statusPending => 'Waiting';

  @override
  String get statusApplied => 'Done';

  @override
  String get statusRejected => 'Not accepted';

  @override
  String get statusConflict => 'Mizan\'s count won';

  @override
  String opCount(String code, int quantity) {
    return 'Count $code: $quantity';
  }

  @override
  String get nothingYet => 'Nothing counted on this phone yet.';

  @override
  String get tabCount => 'Count';

  @override
  String get tabPick => 'Pick & pack';

  @override
  String get pickListsTitle => 'Pick lists';

  @override
  String get refresh => 'Refresh';

  @override
  String get noPickLists =>
      'No pick list on this phone. Refresh when online, after a list is made.';

  @override
  String get pickListsSignIn => 'Sign in to load pick lists.';

  @override
  String pickListLabel(int number) {
    return 'List $number';
  }

  @override
  String pickListSummary(int orders, int packed) {
    String _temp0 = intl.Intl.pluralLogic(
      orders,
      locale: localeName,
      other: '$orders orders',
      one: '1 order',
    );
    return '$_temp0 · $packed packed';
  }

  @override
  String fetchedAt(String time) {
    return 'Updated $time';
  }

  @override
  String get toPick => 'To pick, by shelf';

  @override
  String get ordersToPack => 'Orders to pack';

  @override
  String get noShelf => 'No shelf';

  @override
  String get pack => 'Pack';

  @override
  String get packed => 'Packed';

  @override
  String packTitle(String number) {
    return 'Pack order $number';
  }

  @override
  String get scanHint => 'Scan each item into the box';

  @override
  String get typeCode => 'Barcode won\'t read? Type it';

  @override
  String get add => 'Add';

  @override
  String scanCounted(String title) {
    return 'Added: $title';
  }

  @override
  String get scanWrong => 'Not on this order. Keep it out of the box.';

  @override
  String scanTooMany(String title) {
    return '$title: all of it is already in the box.';
  }

  @override
  String progress(int scanned, int wanted) {
    return '$scanned of $wanted items';
  }

  @override
  String get finishPack => 'Box packed';

  @override
  String packSaved(String number) {
    return 'Order $number packed. It syncs when there is a connection.';
  }

  @override
  String get removeOne => 'Take one out';
}
