import 'package:flutter/material.dart';
import 'package:mobile_scanner/mobile_scanner.dart';

/// The phone's camera reading barcodes and QR codes (mobile_scanner): each code read is passed on.
Widget cameraScanner(BuildContext context, void Function(String code) onCode) => MobileScanner(
      onDetect: (capture) {
        for (final b in capture.barcodes) {
          final v = b.rawValue;
          if (v != null && v.isNotEmpty) onCode(v);
        }
      },
    );
