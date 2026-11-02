import 'dart:async';
import 'dart:convert';

import 'package:http/http.dart' as http;

import '../sync/sync_api.dart';

/// The pick lists the warehouse works from (GET /v1/picklists, E8-4c), as raw JSON for the cache.
abstract interface class PickApi {
  /// Open lists, newest first: their ids.
  Future<List<String>> openListIds();

  /// One list, with its items by shelf and each order's lines.
  Future<Map<String, Object?>> list(String id);
}

class HttpPickApi implements PickApi {
  HttpPickApi({required this.baseUrl, required this.token, required this.tenantId, http.Client? client, this.timeout = const Duration(seconds: 20)})
      : _client = client ?? http.Client();

  final Uri baseUrl;
  final Future<String> Function() token;
  final String Function() tenantId;
  final Duration timeout;
  final http.Client _client;

  Future<Object?> _get(String path) async {
    final http.Response res;
    try {
      res = await _client.get(baseUrl.resolve(path), headers: {'authorization': 'Bearer ${await token()}', 'x-tenant-id': tenantId(), 'accept': 'application/json'}).timeout(timeout);
    } on TimeoutException {
      throw SyncFailure(SyncFailureKind.offline, 'no answer in time');
    } on http.ClientException catch (e) {
      throw SyncFailure(SyncFailureKind.offline, e.message);
    }
    if (res.statusCode == 200) return jsonDecode(utf8.decode(res.bodyBytes));
    throw switch (res.statusCode) {
      401 => SyncFailure(SyncFailureKind.signedOut, 'sign in again'),
      403 => SyncFailure(SyncFailureKind.forbidden, 'this role cannot pick'),
      _ => SyncFailure(SyncFailureKind.server, 'server answered ${res.statusCode}'),
    };
  }

  @override
  Future<List<String>> openListIds() async {
    final body = await _get('/v1/picklists?status=open') as Map<String, Object?>;
    return [for (final r in body['data'] as List) ((r as Map)['id'] as String)];
  }

  @override
  Future<Map<String, Object?>> list(String id) async => ((await _get('/v1/picklists/$id')) as Map).cast<String, Object?>();
}
