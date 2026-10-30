import 'dart:async';
import 'dart:convert';

import 'package:http/http.dart' as http;

import 'op.dart';

/// Why a sync attempt failed, and so what the engine does next.
/// - offline: no network, a timeout, or the answer was lost: the same ops go again later
/// - server: Mizan or the network in between is unwell (5xx, 429): back off, then the same ops again
/// - signedOut: the session ended (401): stop until the user signs in again
/// - forbidden: the user's role cannot sync (403): stop and tell them
/// - invalid: the server refused the batch as a whole (400/422): stop; a bug, never retried blindly
enum SyncFailureKind { offline, server, signedOut, forbidden, invalid }

class SyncFailure implements Exception {
  SyncFailure(this.kind, this.message, {this.retryAfter});
  final SyncFailureKind kind;
  final String message;
  final Duration? retryAfter;

  @override
  String toString() => 'SyncFailure(${kind.name}): $message';
}

/// The server's side of the sync: one batch of ops in, one outcome per op out.
abstract interface class SyncApi {
  Future<List<OpOutcome>> sync(String deviceId, List<Op> ops);
}

/// POST /v1/ops/sync (E8-3) with the signed-in user's token and the chosen store.
class HttpSyncApi implements SyncApi {
  HttpSyncApi({required this.baseUrl, required this.token, required this.tenantId, http.Client? client, this.timeout = const Duration(seconds: 30)})
      : _client = client ?? http.Client();

  final Uri baseUrl;

  /// A fresh ID token for each call (Firebase refreshes it).
  final Future<String> Function() token;
  final String Function() tenantId;
  final Duration timeout;
  final http.Client _client;

  @override
  Future<List<OpOutcome>> sync(String deviceId, List<Op> ops) async {
    final http.Response res;
    try {
      res = await _client
          .post(baseUrl.resolve('/v1/ops/sync'),
              headers: {
                'authorization': 'Bearer ${await token()}',
                'x-tenant-id': tenantId(),
                'content-type': 'application/json',
                'accept': 'application/json',
              },
              body: jsonEncode({'deviceId': deviceId, 'ops': ops.map((o) => o.toWire()).toList()}))
          .timeout(timeout);
    } on TimeoutException {
      throw SyncFailure(SyncFailureKind.offline, 'no answer in time');
    } on http.ClientException catch (e) {
      throw SyncFailure(SyncFailureKind.offline, e.message);
    }
    if (res.statusCode == 200) {
      final body = jsonDecode(utf8.decode(res.bodyBytes)) as Map<String, Object?>;
      return (body['results'] as List).map((r) => OpOutcome.fromJson((r as Map).cast<String, Object?>())).toList();
    }
    final retryAfter = int.tryParse(res.headers['retry-after'] ?? '');
    final wait = retryAfter == null ? null : Duration(seconds: retryAfter);
    throw switch (res.statusCode) {
      401 => SyncFailure(SyncFailureKind.signedOut, 'sign in again'),
      403 => SyncFailure(SyncFailureKind.forbidden, 'this role cannot sync'),
      400 || 422 => SyncFailure(SyncFailureKind.invalid, 'the server refused the batch (${res.statusCode})'),
      _ => SyncFailure(SyncFailureKind.server, 'server answered ${res.statusCode}', retryAfter: wait),
    };
  }
}
