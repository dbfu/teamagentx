import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:mobile_scanner/mobile_scanner.dart';
import 'package:permission_handler/permission_handler.dart';
import 'package:provider/provider.dart';
import '../stores/auth_store.dart';
import '../constants/colors.dart';

/// 登录页面
class LoginPage extends StatefulWidget {
  const LoginPage({super.key});

  @override
  State<LoginPage> createState() => _LoginPageState();
}

class _LoginPageState extends State<LoginPage> {
  bool _isScanning = false;
  MobileScannerController? _scannerController;

  @override
  void dispose() {
    _scannerController?.dispose();
    super.dispose();
  }

  Future<void> _handleScanQRCode() async {
    final status = await Permission.camera.request();
    if (!status.isGranted) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('需要相机权限才能扫描二维码')),
      );
      return;
    }

    setState(() {
      _isScanning = true;
      _scannerController = MobileScannerController();
    });
  }

  void _handleQRCodeDetected(BarcodeCapture capture) {
    final barcodes = capture.barcodes;
    if (barcodes.isEmpty) return;

    final data = barcodes.first.rawValue;
    if (data == null) return;

    _scannerController?.stop();
    setState(() {
      _isScanning = false;
    });

    try {
      final result = _parseQRCodePayload(data);
      if (result != null) {
        _qrLogin(result['url']!, result['token']!, result['username']!);
        return;
      }

      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('二维码内容无效，请扫描桌面端二维码')),
      );
    } catch (e) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('二维码格式不正确')),
      );
    }
  }

  Map<String, String>? _parseQRCodePayload(String data) {
    final trimmed = data.trim();

    final uri = Uri.tryParse(trimmed);
    if (uri != null &&
        (uri.scheme == 'http' || uri.scheme == 'https') &&
        uri.hasAuthority) {
      final token = uri.queryParameters['token'];
      final username = uri.queryParameters['username'];
      final serverUrl = uri.queryParameters['serverUrl'] ?? _originFromUri(uri);

      if (token != null &&
          token.isNotEmpty &&
          username != null &&
          username.isNotEmpty &&
          serverUrl.isNotEmpty) {
        return {
          'url': serverUrl,
          'token': token,
          'username': username,
        };
      }
    }

    // 兼容旧版桌面端生成的 JSON 二维码。
    if (trimmed.startsWith('{')) {
      final result = jsonDecode(trimmed) as Map<String, dynamic>;
      final url = result['url'];
      final token = result['token'];
      final username = result['username'];

      if (url is String &&
          url.isNotEmpty &&
          token is String &&
          token.isNotEmpty &&
          username is String &&
          username.isNotEmpty) {
        return {
          'url': url,
          'token': token,
          'username': username,
        };
      }
    }

    return null;
  }

  String _originFromUri(Uri uri) {
    final host = uri.host.contains(':') ? '[${uri.host}]' : uri.host;
    final port = uri.hasPort ? ':${uri.port}' : '';
    return '${uri.scheme}://$host$port';
  }

  Future<void> _qrLogin(String url, String token, String username) async {
    final authStore = context.read<AuthStore>();
    final result = await authStore.qrLogin(url, token, username);

    if (result['success'] == true) {
      context.go('/');
    } else {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(result['error'] ?? '登录失败')),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;

    // 扫描二维码界面
    if (_isScanning) {
      return Scaffold(
        backgroundColor: Colors.black,
        body: Stack(
          children: [
            MobileScanner(
              controller: _scannerController!,
              onDetect: _handleQRCodeDetected,
            ),

            // 顶部导航和标题
            Positioned(
              top: 56,
              left: 24,
              right: 24,
              child: Column(
                children: [
                  GestureDetector(
                    onTap: () {
                      _scannerController?.stop();
                      setState(() {
                        _isScanning = false;
                      });
                    },
                    child: Container(
                      width: 40,
                      height: 40,
                      decoration: BoxDecoration(
                        shape: BoxShape.circle,
                        color: Colors.white.withOpacity(0.2),
                      ),
                      child: const Icon(Icons.close, color: Colors.white),
                    ),
                  ),
                  const SizedBox(height: 16),
                  const Text(
                    '扫描桌面端二维码',
                    style: TextStyle(
                      color: Colors.white,
                      fontSize: 18,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                  const SizedBox(height: 4),
                  Text(
                    '请在桌面端设置页面找到二维码并扫描',
                    style: TextStyle(
                      color: Colors.white.withOpacity(0.7),
                      fontSize: 14,
                    ),
                  ),
                ],
              ),
            ),

            // 居中的扫描框
            Center(
              child: Container(
                width: 256,
                height: 256,
                decoration: BoxDecoration(
                  border: Border.all(
                    color: Colors.white.withOpacity(0.5),
                    width: 2,
                  ),
                  borderRadius: BorderRadius.circular(8),
                ),
              ),
            ),
            Positioned(
              top: MediaQuery.of(context).size.height / 2 - 150,
              left: 0,
              right: 0,
              child: Text(
                '将二维码放入框内',
                textAlign: TextAlign.center,
                style: TextStyle(
                  color: Colors.white.withOpacity(0.5),
                  fontSize: 14,
                ),
              ),
            ),
          ],
        ),
      );
    }

    return Scaffold(
      backgroundColor: AppColors.getBackground(isDark),
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(24),
          child: Column(
            children: [
              const SizedBox(height: 48),

              // Logo
              Image.asset(
                'assets/icon.png',
                width: 96,
                height: 96,
              ),
              const SizedBox(height: 16),
              const Text(
                'TeamAgentX',
                style: TextStyle(
                  fontSize: 24,
                  fontWeight: FontWeight.bold,
                ),
              ),

              const SizedBox(height: 32),

              // 扫码登录提示
              Text(
                '扫描桌面端二维码即可快速登录',
                style: TextStyle(
                  fontSize: 16,
                  color: AppColors.getTextSecondary(isDark),
                ),
                textAlign: TextAlign.center,
              ),
              const SizedBox(height: 24),

              GestureDetector(
                onTap: _handleScanQRCode,
                child: Container(
                  width: double.infinity,
                  height: 56,
                  decoration: BoxDecoration(
                    color: AppColors.primary,
                    borderRadius: BorderRadius.circular(16),
                  ),
                  child: Row(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      const Icon(
                        Icons.camera_alt,
                        color: Colors.white,
                        size: 22,
                      ),
                      const SizedBox(width: 8),
                      const Text(
                        '扫描二维码登录',
                        style: TextStyle(
                          color: Colors.white,
                          fontSize: 18,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
