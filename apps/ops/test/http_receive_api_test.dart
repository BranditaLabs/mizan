import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:mizan_ops/receive/receive_api.dart';
import 'package:mizan_ops/sync/sync_api.dart';

/// M16-3: the phone reads the open purchase orders with the store's header and its token.
void main() {
  final requests = <http.Request>[];
  HttpReceiveApi api(int status) => HttpReceiveApi(
        baseUrl: Uri.parse('https://api.mizan.test'),
        token: () async => 'token-1',
        tenantId: () => 'store-1',
        client: MockClient((r) async {
          requests.add(r);
          if (status != 200) return http.Response('{}', status);
          final body = r.url.path == '/v1/purchase-orders'
              ? {'data': [{'id': 'po-1'}, {'id': 'po-2'}], 'counts': {}}
              : {'id': 'po-1', 'number': 'PO-0001', 'lines': []};
          return http.Response(jsonEncode(body), 200);
        }),
      );

  test('lists open POs and reads one', () async {
    requests.clear();
    expect(await api(200).openPoIds(), ['po-1', 'po-2']);
    expect((await api(200).po('po-1'))['number'], 'PO-0001');
    expect(requests.first.url.query, 'status=open&limit=100');
    expect(requests.first.headers['authorization'], 'Bearer token-1');
    expect(requests.first.headers['x-tenant-id'], 'store-1');
    expect(requests.last.url.path, '/v1/purchase-orders/po-1');
  });

  test('a role without receiving, or a signed-out phone, is told so', () async {
    await expectLater(api(403).openPoIds(), throwsA(isA<SyncFailure>().having((f) => f.kind, 'kind', SyncFailureKind.forbidden)));
    await expectLater(api(401).openPoIds(), throwsA(isA<SyncFailure>().having((f) => f.kind, 'kind', SyncFailureKind.signedOut)));
  });
}
