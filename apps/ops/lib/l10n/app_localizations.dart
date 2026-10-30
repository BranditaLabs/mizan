import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/widgets.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:intl/intl.dart' as intl;

import 'app_localizations_ar.dart';
import 'app_localizations_en.dart';

// ignore_for_file: type=lint

/// Callers can lookup localized strings with an instance of AppLocalizations
/// returned by `AppLocalizations.of(context)`.
///
/// Applications need to include `AppLocalizations.delegate()` in their app's
/// `localizationDelegates` list, and the locales they support in the app's
/// `supportedLocales` list. For example:
///
/// ```dart
/// import 'l10n/app_localizations.dart';
///
/// return MaterialApp(
///   localizationsDelegates: AppLocalizations.localizationsDelegates,
///   supportedLocales: AppLocalizations.supportedLocales,
///   home: MyApplicationHome(),
/// );
/// ```
///
/// ## Update pubspec.yaml
///
/// Please make sure to update your pubspec.yaml to include the following
/// packages:
///
/// ```yaml
/// dependencies:
///   # Internationalization support.
///   flutter_localizations:
///     sdk: flutter
///   intl: any # Use the pinned version from flutter_localizations
///
///   # Rest of dependencies
/// ```
///
/// ## iOS Applications
///
/// iOS applications define key application metadata, including supported
/// locales, in an Info.plist file that is built into the application bundle.
/// To configure the locales supported by your app, you’ll need to edit this
/// file.
///
/// First, open your project’s ios/Runner.xcworkspace Xcode workspace file.
/// Then, in the Project Navigator, open the Info.plist file under the Runner
/// project’s Runner folder.
///
/// Next, select the Information Property List item, select Add Item from the
/// Editor menu, then select Localizations from the pop-up menu.
///
/// Select and expand the newly-created Localizations item then, for each
/// locale your application supports, add a new item and select the locale
/// you wish to add from the pop-up menu in the Value field. This list should
/// be consistent with the languages listed in the AppLocalizations.supportedLocales
/// property.
abstract class AppLocalizations {
  AppLocalizations(String locale)
    : localeName = intl.Intl.canonicalizedLocale(locale.toString());

  final String localeName;

  static AppLocalizations of(BuildContext context) {
    return Localizations.of<AppLocalizations>(context, AppLocalizations)!;
  }

  static const LocalizationsDelegate<AppLocalizations> delegate =
      _AppLocalizationsDelegate();

  /// A list of this localizations delegate along with the default localizations
  /// delegates.
  ///
  /// Returns a list of localizations delegates containing this delegate along with
  /// GlobalMaterialLocalizations.delegate, GlobalCupertinoLocalizations.delegate,
  /// and GlobalWidgetsLocalizations.delegate.
  ///
  /// Additional delegates can be added by appending to this list in
  /// MaterialApp. This list does not have to be used at all if a custom list
  /// of delegates is preferred or required.
  static const List<LocalizationsDelegate<dynamic>> localizationsDelegates =
      <LocalizationsDelegate<dynamic>>[
        delegate,
        GlobalMaterialLocalizations.delegate,
        GlobalCupertinoLocalizations.delegate,
        GlobalWidgetsLocalizations.delegate,
      ];

  /// A list of this localizations delegate's supported locales.
  static const List<Locale> supportedLocales = <Locale>[
    Locale('ar'),
    Locale('en'),
  ];

  /// No description provided for @appTitle.
  ///
  /// In en, this message translates to:
  /// **'Mizan Ops'**
  String get appTitle;

  /// No description provided for @queueTitle.
  ///
  /// In en, this message translates to:
  /// **'Stock on this phone'**
  String get queueTitle;

  /// No description provided for @pending.
  ///
  /// In en, this message translates to:
  /// **'{count, plural, =0{Everything is synced} =1{1 operation waiting to sync} other{{count} operations waiting to sync}}'**
  String pending(int count);

  /// No description provided for @countTitle.
  ///
  /// In en, this message translates to:
  /// **'Count an item'**
  String get countTitle;

  /// No description provided for @itemCode.
  ///
  /// In en, this message translates to:
  /// **'Barcode or SKU'**
  String get itemCode;

  /// No description provided for @itemCodeHint.
  ///
  /// In en, this message translates to:
  /// **'Scan or type it'**
  String get itemCodeHint;

  /// No description provided for @quantity.
  ///
  /// In en, this message translates to:
  /// **'Quantity on the shelf'**
  String get quantity;

  /// No description provided for @save.
  ///
  /// In en, this message translates to:
  /// **'Save the count'**
  String get save;

  /// No description provided for @saved.
  ///
  /// In en, this message translates to:
  /// **'Saved on the phone. It syncs when there is a connection.'**
  String get saved;

  /// No description provided for @invalidQuantity.
  ///
  /// In en, this message translates to:
  /// **'Enter a whole number, 0 or more'**
  String get invalidQuantity;

  /// No description provided for @invalidCode.
  ///
  /// In en, this message translates to:
  /// **'Enter the barcode or SKU'**
  String get invalidCode;

  /// No description provided for @syncNow.
  ///
  /// In en, this message translates to:
  /// **'Sync now'**
  String get syncNow;

  /// No description provided for @signInToSync.
  ///
  /// In en, this message translates to:
  /// **'Sign in to sync these with Mizan.'**
  String get signInToSync;

  /// No description provided for @syncFailedOffline.
  ///
  /// In en, this message translates to:
  /// **'No connection. Saved on the phone; Mizan gets it later.'**
  String get syncFailedOffline;

  /// No description provided for @syncFailedServer.
  ///
  /// In en, this message translates to:
  /// **'Mizan is busy. It will try again.'**
  String get syncFailedServer;

  /// No description provided for @synced.
  ///
  /// In en, this message translates to:
  /// **'Synced'**
  String get synced;

  /// No description provided for @statusPending.
  ///
  /// In en, this message translates to:
  /// **'Waiting'**
  String get statusPending;

  /// No description provided for @statusApplied.
  ///
  /// In en, this message translates to:
  /// **'Done'**
  String get statusApplied;

  /// No description provided for @statusRejected.
  ///
  /// In en, this message translates to:
  /// **'Not accepted'**
  String get statusRejected;

  /// No description provided for @statusConflict.
  ///
  /// In en, this message translates to:
  /// **'Mizan\'s count won'**
  String get statusConflict;

  /// No description provided for @opCount.
  ///
  /// In en, this message translates to:
  /// **'Count {code}: {quantity}'**
  String opCount(String code, int quantity);

  /// No description provided for @nothingYet.
  ///
  /// In en, this message translates to:
  /// **'Nothing counted on this phone yet.'**
  String get nothingYet;

  /// No description provided for @tabCount.
  ///
  /// In en, this message translates to:
  /// **'Count'**
  String get tabCount;

  /// No description provided for @tabPick.
  ///
  /// In en, this message translates to:
  /// **'Pick & pack'**
  String get tabPick;

  /// No description provided for @pickListsTitle.
  ///
  /// In en, this message translates to:
  /// **'Pick lists'**
  String get pickListsTitle;

  /// No description provided for @refresh.
  ///
  /// In en, this message translates to:
  /// **'Refresh'**
  String get refresh;

  /// No description provided for @noPickLists.
  ///
  /// In en, this message translates to:
  /// **'No pick list on this phone. Refresh when online, after a list is made.'**
  String get noPickLists;

  /// No description provided for @pickListsSignIn.
  ///
  /// In en, this message translates to:
  /// **'Sign in to load pick lists.'**
  String get pickListsSignIn;

  /// No description provided for @pickListLabel.
  ///
  /// In en, this message translates to:
  /// **'List {number}'**
  String pickListLabel(int number);

  /// No description provided for @pickListSummary.
  ///
  /// In en, this message translates to:
  /// **'{orders, plural, =1{1 order} other{{orders} orders}} · {packed} packed'**
  String pickListSummary(int orders, int packed);

  /// No description provided for @fetchedAt.
  ///
  /// In en, this message translates to:
  /// **'Updated {time}'**
  String fetchedAt(String time);

  /// No description provided for @toPick.
  ///
  /// In en, this message translates to:
  /// **'To pick, by shelf'**
  String get toPick;

  /// No description provided for @ordersToPack.
  ///
  /// In en, this message translates to:
  /// **'Orders to pack'**
  String get ordersToPack;

  /// No description provided for @noShelf.
  ///
  /// In en, this message translates to:
  /// **'No shelf'**
  String get noShelf;

  /// No description provided for @pack.
  ///
  /// In en, this message translates to:
  /// **'Pack'**
  String get pack;

  /// No description provided for @packed.
  ///
  /// In en, this message translates to:
  /// **'Packed'**
  String get packed;

  /// No description provided for @packTitle.
  ///
  /// In en, this message translates to:
  /// **'Pack order {number}'**
  String packTitle(String number);

  /// No description provided for @scanHint.
  ///
  /// In en, this message translates to:
  /// **'Scan each item into the box'**
  String get scanHint;

  /// No description provided for @typeCode.
  ///
  /// In en, this message translates to:
  /// **'Barcode won\'t read? Type it'**
  String get typeCode;

  /// No description provided for @add.
  ///
  /// In en, this message translates to:
  /// **'Add'**
  String get add;

  /// No description provided for @scanCounted.
  ///
  /// In en, this message translates to:
  /// **'Added: {title}'**
  String scanCounted(String title);

  /// No description provided for @scanWrong.
  ///
  /// In en, this message translates to:
  /// **'Not on this order. Keep it out of the box.'**
  String get scanWrong;

  /// No description provided for @scanTooMany.
  ///
  /// In en, this message translates to:
  /// **'{title}: all of it is already in the box.'**
  String scanTooMany(String title);

  /// No description provided for @progress.
  ///
  /// In en, this message translates to:
  /// **'{scanned} of {wanted} items'**
  String progress(int scanned, int wanted);

  /// No description provided for @finishPack.
  ///
  /// In en, this message translates to:
  /// **'Box packed'**
  String get finishPack;

  /// No description provided for @packSaved.
  ///
  /// In en, this message translates to:
  /// **'Order {number} packed. It syncs when there is a connection.'**
  String packSaved(String number);

  /// No description provided for @removeOne.
  ///
  /// In en, this message translates to:
  /// **'Take one out'**
  String get removeOne;
}

class _AppLocalizationsDelegate
    extends LocalizationsDelegate<AppLocalizations> {
  const _AppLocalizationsDelegate();

  @override
  Future<AppLocalizations> load(Locale locale) {
    return SynchronousFuture<AppLocalizations>(lookupAppLocalizations(locale));
  }

  @override
  bool isSupported(Locale locale) =>
      <String>['ar', 'en'].contains(locale.languageCode);

  @override
  bool shouldReload(_AppLocalizationsDelegate old) => false;
}

AppLocalizations lookupAppLocalizations(Locale locale) {
  // Lookup logic when only language code is specified.
  switch (locale.languageCode) {
    case 'ar':
      return AppLocalizationsAr();
    case 'en':
      return AppLocalizationsEn();
  }

  throw FlutterError(
    'AppLocalizations.delegate failed to load unsupported locale "$locale". This is likely '
    'an issue with the localizations generation tool. Please file an issue '
    'on GitHub with a reproducible sample app and the gen-l10n configuration '
    'that was used.',
  );
}
