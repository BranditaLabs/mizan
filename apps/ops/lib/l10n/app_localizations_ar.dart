// ignore: unused_import
import 'package:intl/intl.dart' as intl;

import 'app_localizations.dart';

// ignore_for_file: type=lint

/// The translations for Arabic (`ar`).
class AppLocalizationsAr extends AppLocalizations {
  AppLocalizationsAr([String locale = 'ar']) : super(locale);

  @override
  String get appTitle => 'ميزان للتشغيل';

  @override
  String get queueTitle => 'المخزون على الموبايل ده';

  @override
  String pending(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count عمليات مستنية تتزامن',
      one: 'عملية واحدة مستنية تتزامن',
      zero: 'كله اتزامن',
    );
    return '$_temp0';
  }

  @override
  String get countTitle => 'عِد صنف';

  @override
  String get itemCode => 'الباركود أو الـ SKU';

  @override
  String get itemCodeHint => 'امسحه أو اكتبه';

  @override
  String get quantity => 'الكمية على الرف';

  @override
  String get save => 'احفظ العدّ';

  @override
  String get saved => 'اتحفظ على الموبايل. هيتزامن أول ما يبقى فيه نت.';

  @override
  String get invalidQuantity => 'اكتب رقم صحيح، صفر أو أكتر';

  @override
  String get invalidCode => 'اكتب الباركود أو الـ SKU';

  @override
  String get syncNow => 'زامن دلوقتي';

  @override
  String get signInToSync => 'سجّل دخول عشان تزامن دول مع ميزان.';

  @override
  String get syncFailedOffline =>
      'مفيش نت. اتحفظ على الموبايل وميزان هياخده بعدين.';

  @override
  String get syncFailedServer => 'ميزان مشغول. هيحاول تاني.';

  @override
  String get synced => 'اتزامن';

  @override
  String get statusPending => 'مستني';

  @override
  String get statusApplied => 'تمام';

  @override
  String get statusRejected => 'مااتقبلش';

  @override
  String get statusConflict => 'عدّ ميزان هو اللي اتاخد';

  @override
  String opCount(String code, int quantity) {
    return 'عدّ $code: $quantity';
  }

  @override
  String get nothingYet => 'لسه مفيش حاجة اتعدّت على الموبايل ده.';
}
