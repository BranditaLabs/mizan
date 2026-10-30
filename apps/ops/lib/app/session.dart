/// Who is signed in and in which store (Firebase sign-in comes with E8-4 part 2). Until then the
/// app works offline: operations queue on the phone and sync once a session exists.
abstract interface class Session {
  Future<String> token();
  String get tenantId;
}
