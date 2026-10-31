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

  @override
  String get tabCount => 'عدّ';

  @override
  String get tabPick => 'تجهيز وتقفيل';

  @override
  String get pickListsTitle => 'قوايم التجهيز';

  @override
  String get refresh => 'حدّث';

  @override
  String get noPickLists =>
      'مفيش قايمة تجهيز على الموبايل ده. حدّث وانت أونلاين بعد ما تتعمل قايمة.';

  @override
  String get pickListsSignIn => 'سجّل دخول عشان تجيب قوايم التجهيز.';

  @override
  String pickListLabel(int number) {
    return 'قايمة $number';
  }

  @override
  String pickListSummary(int orders, int packed) {
    String _temp0 = intl.Intl.pluralLogic(
      orders,
      locale: localeName,
      other: '$orders أوردرات',
      one: 'أوردر واحد',
    );
    return '$_temp0 · $packed اتقفلوا';
  }

  @override
  String fetchedAt(String time) {
    return 'اتحدّثت $time';
  }

  @override
  String get toPick => 'هتاخد إيه، بالرف';

  @override
  String get ordersToPack => 'أوردرات للتقفيل';

  @override
  String get noShelf => 'من غير رف';

  @override
  String get pack => 'قفّل';

  @override
  String get packed => 'اتقفل';

  @override
  String packTitle(String number) {
    return 'تقفيل أوردر $number';
  }

  @override
  String get scanHint => 'امسح كل صنف وانت بتحطه في الكرتونة';

  @override
  String get typeCode => 'الباركود مش بيتقري؟ اكتبه';

  @override
  String get add => 'ضيف';

  @override
  String scanCounted(String title) {
    return 'اتضاف: $title';
  }

  @override
  String get scanWrong => 'ده مش في الأوردر ده. ماتحطوش في الكرتونة.';

  @override
  String scanTooMany(String title) {
    return '$title: الكمية كلها في الكرتونة خلاص.';
  }

  @override
  String progress(int scanned, int wanted) {
    return '$scanned من $wanted صنف';
  }

  @override
  String get finishPack => 'الكرتونة اتقفلت';

  @override
  String packSaved(String number) {
    return 'أوردر $number اتقفل. هيتزامن أول ما يبقى فيه نت.';
  }

  @override
  String get removeOne => 'شيل واحد';

  @override
  String get tabReceive => 'استلام';

  @override
  String get receiveTitle => 'أوامر شراء للاستلام';

  @override
  String get noPurchaseOrders =>
      'مفيش أوامر شراء على الموبايل. اعمل تحديث لما يبقى فيه نت، بعد ما واحد يتوافق عليه.';

  @override
  String get receiveSignIn => 'سجّل دخول عشان تحمّل أوامر الشراء.';

  @override
  String stillExpected(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count قطعة لسه جايين',
      few: '$count قطع لسه جايين',
      two: 'قطعتين لسه جايين',
      one: 'قطعة واحدة لسه جاية',
      zero: 'مفيش حاجة فاضلة',
    );
    return '$_temp0';
  }

  @override
  String receivePoTitle(String number) {
    return 'استلام $number';
  }

  @override
  String get receiveHint => 'اعمل سكان لكل قطعة وهي نازلة من التسليم.';

  @override
  String receiveCounted(String title) {
    return 'اتستلم: $title';
  }

  @override
  String receiveDamagedCounted(String title) {
    return 'تالف: $title';
  }

  @override
  String get receiveWrong => 'مش في أمر الشراء ده. حطه على جنب.';

  @override
  String receiveTooMany(String title) {
    return '$title وصل كله. الزيادة محتاجة مدير من الويب.';
  }

  @override
  String get damagedMode => 'قطع تالفة';

  @override
  String get damagedModeHint => 'السكان بيتحسب تالف: بيتسجل ومش بيدخل المخزن.';

  @override
  String receiveTotals(int good, int damaged) {
    return '$good سليم · $damaged تالف';
  }

  @override
  String damagedCount(int count) {
    return '$count تالف';
  }

  @override
  String get saveDelivery => 'احفظ التسليم';

  @override
  String deliverySaved(String number) {
    return 'تسليم $number اتحفظ. هيتبعت لما يبقى فيه نت.';
  }
}
