import 'dart:async';
import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:mizan_ops/sync/op.dart';
import 'package:mizan_ops/sync/sync_api.dart';

/// The wire side of the sync (POST /v1/ops/sync): what is sent, and how each answer is read.
void main() {
  final op = Op(opId: 'op-00000001', type: OpTypes.stockCount, payload: {'barcode': '6221234567890', 'quantity': 4}, at: DateTime.utc(2026, 10, 30, 9));
  HttpSyncApi api(MockClientHandler h, {Duration timeout = const Duration(seconds: 1)}) =>
      HttpSyncApi(baseUrl: Uri.parse('https://api.mizan.test'), token: () async => 'id-token', tenantId: () => 'tenant-1', client: MockClient(h), timeout: timeout);

  test('sends the token, the store and the batch; reads each outcome', () async {
    late http.Request seen;
    final outcomes = await api((req) async {
      seen = req;
      return http.Response(jsonEncode({
        'serverTime': '2026-10-30T09:00:01.000Z',
        'results': [{'opId': 'op-00000001', 'status': 'duplicate', 'original': 'applied', 'code': null, 'message': null, 'result': {'onHand': 4}}],
      }), 200, headers: {'content-type': 'application/json'});
    }).sync('phone-1', [op]);
    expect(seen.url.toString(), 'https://api.mizan.test/v1/ops/sync');
    expect(seen.headers['authorization'], 'Bearer id-token');
    expect(seen.headers['x-tenant-id'], 'tenant-1');
    expect(jsonDecode(seen.body), {
      'deviceId': 'phone-1',
      'ops': [{'opId': 'op-00000001', 'type': 'stock.count', 'payload': {'barcode': '6221234567890', 'quantity': 4}, 'at': '2026-10-30T09:00:00.000Z'}],
    });
    expect(outcomes.single.finalStatus, OpStatus.applied);
    expect(outcomes.single.result, {'onHand': 4});
  });

  Future<SyncFailure> failure(MockClientHandler h, {Duration timeout = const Duration(seconds: 1)}) async {
    try {
      await api(h, timeout: timeout).sync('phone-1', [op]);
    } on SyncFailure catch (f) {
      return f;
    }
    fail('expected a SyncFailure');
  }

  test('each failure has its kind', () async {
    expect((await failure((_) async => http.Response('', 401))).kind, SyncFailureKind.signedOut);
    expect((await failure((_) async => http.Response('', 403))).kind, SyncFailureKind.forbidden);
    expect((await failure((_) async => http.Response('{}', 422))).kind, SyncFailureKind.invalid);
    final busy = await failure((_) async => http.Response('', 503, headers: {'retry-after': '7'}));
    expect([busy.kind, busy.retryAfter], [SyncFailureKind.server, const Duration(seconds: 7)]);
    expect((await failure((_) async => throw http.ClientException('connection reset'))).kind, SyncFailureKind.offline);
    expect((await failure((_) => Completer<http.Response>().future, timeout: const Duration(milliseconds: 20))).kind, SyncFailureKind.offline);
  });
}
