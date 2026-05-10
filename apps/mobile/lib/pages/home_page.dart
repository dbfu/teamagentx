import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:go_router/go_router.dart';
import 'package:webview_flutter/webview_flutter.dart';
import 'package:provider/provider.dart';
import 'package:url_launcher/url_launcher.dart';
import '../stores/auth_store.dart';
import '../stores/theme_store.dart';
import '../services/storage_service.dart';
import '../constants/colors.dart';

/// 主页（WebView）
class HomePage extends StatefulWidget {
  const HomePage({super.key});

  @override
  State<HomePage> createState() => _HomePageState();
}

class _HomePageState extends State<HomePage> {
  String? _webUrl;
  String? _token;
  bool _isLoading = true;
  bool _hasError = false;
  String _draftUrl = '';
  WebViewController? _controller;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      _init();
    });
  }

  @override
  void dispose() {
    // 清理 WebView 控制器
    _controller = null;
    super.dispose();
  }

  Future<void> _init() async {
    final authStore = context.read<AuthStore>();

    // 检查认证状态
    await authStore.checkAuth();

    if (authStore.authState == AuthState.unauthenticated) {
      context.go('/login');
      return;
    }

    // 加载服务器地址和 token
    _webUrl = await StorageService.getServerUrl();
    _token = await StorageService.getToken();
    _draftUrl = _webUrl ?? '';

    if (_webUrl != null && _webUrl!.isNotEmpty) {
      _initWebView();
    }

    setState(() {
      _isLoading = false;
    });
  }

  void _initWebView() {
    _controller = WebViewController()
      ..setJavaScriptMode(JavaScriptMode.unrestricted)
      ..setNavigationDelegate(
        NavigationDelegate(
          onNavigationRequest: (request) {
            if (_shouldOpenExternally(request.url)) {
              _openExternalUrl(request.url);
              return NavigationDecision.prevent;
            }
            return NavigationDecision.navigate;
          },
          onPageStarted: (url) {
            setState(() {
              _isLoading = true;
            });
            // 页面开始加载时立即注入 token
            if (_token != null && _token!.isNotEmpty) {
              _controller!.runJavaScript(
                'localStorage.setItem("auth_token", "$_token");',
              );
            }
          },
          onPageFinished: (url) {
            setState(() {
              _isLoading = false;
              _hasError = false;
            });
            // 注入安全区域 CSS 变量
            _injectSafeAreaInsets();
            _injectExternalLinkHandler();
          },
          onWebResourceError: (error) {
            setState(() {
              _hasError = true;
              _isLoading = false;
            });
          },
        ),
      )
      ..addJavaScriptChannel(
        'FlutterChannel',
        onMessageReceived: (message) {
          // 处理 WebView 消息（Web 端退出登录、主题变化等）
          try {
            final payload = jsonDecode(message.message);
            if (payload is! Map<String, dynamic>) return;

            final type = payload['type'];

            if (type == 'logout') {
              _logout();
            } else if (type == 'themeChange') {
              final theme = payload['theme'];
              if (theme != null) {
                _updateThemeFromWeb(theme.toString());
              }
            } else if (type == 'openExternalUrl') {
              final url = payload['url'];
              if (url != null) {
                _openExternalUrl(url.toString());
              }
            }
          } catch (e) {
            // 忽略非 JSON 消息
          }
        },
      );

    _controller!.loadRequest(Uri.parse(_webUrl!));

    // 立即注入 token（在页面内容加载之前）
    // 使用延迟确保 WebView 上下文已准备好
    if (_token != null && _token!.isNotEmpty) {
      Future.delayed(const Duration(milliseconds: 50), () {
        _controller?.runJavaScript(
          'localStorage.setItem("auth_token", "$_token");',
        );
      });
    }
  }

  bool _isHttpUrl(Uri uri) {
    return uri.scheme == 'http' || uri.scheme == 'https';
  }

  bool _shouldOpenExternally(String url) {
    final uri = Uri.tryParse(url);
    final appUri = _webUrl == null ? null : Uri.tryParse(_webUrl!);

    if (uri == null || appUri == null || !_isHttpUrl(uri)) {
      return false;
    }

    return uri.scheme != appUri.scheme ||
        uri.host != appUri.host ||
        uri.port != appUri.port;
  }

  Future<void> _openExternalUrl(String url) async {
    final uri = Uri.tryParse(url);
    if (uri == null || !_isHttpUrl(uri)) {
      return;
    }

    final opened = await launchUrl(uri, mode: LaunchMode.externalApplication);
    if (!opened && mounted) {
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(const SnackBar(content: Text('无法打开链接')));
    }
  }

  /// 拦截 WebView 内 target="_blank" 与 window.open 外链，转给系统默认浏览器。
  void _injectExternalLinkHandler() {
    if (_controller == null || _webUrl == null) return;

    final appOrigin = Uri.parse(_webUrl!).origin;
    _controller!.runJavaScript('''
      (function() {
        if (window.__teamAgentXExternalLinkHandlerInstalled) return;
        window.__teamAgentXExternalLinkHandlerInstalled = true;

        const appOrigin = ${jsonEncode(appOrigin)};
        const shouldOpenExternally = (url) => {
          try {
            const parsed = new URL(url, window.location.href);
            return (parsed.protocol === 'http:' || parsed.protocol === 'https:') &&
              parsed.origin !== appOrigin;
          } catch (_) {
            return false;
          }
        };
        const openExternally = (url) => {
          FlutterChannel.postMessage(JSON.stringify({
            type: 'openExternalUrl',
            url: new URL(url, window.location.href).href
          }));
        };

        document.addEventListener('click', function(event) {
          const anchor = event.target && event.target.closest ? event.target.closest('a[href]') : null;
          if (!anchor || !shouldOpenExternally(anchor.href)) return;
          event.preventDefault();
          event.stopPropagation();
          openExternally(anchor.href);
        }, true);

        const originalOpen = window.open;
        window.open = function(url, target, features) {
          if (url && shouldOpenExternally(url)) {
            openExternally(url);
            return null;
          }
          return originalOpen ? originalOpen.call(window, url, target, features) : null;
        };
      })();
    ''');
  }

  Future<void> _logout() async {
    // 清除 WebView 状态
    _controller = null;
    _webUrl = null;
    _token = null;

    // 清除存储
    await StorageService.deleteToken();

    // 更新认证状态（会触发 build 中的导航）
    final authStore = context.read<AuthStore>();
    await authStore.logout();
  }

  Future<void> _saveWebUrl() async {
    await StorageService.setServerUrl(_draftUrl);
    _webUrl = _draftUrl;
    setState(() {
      _hasError = false;
    });
    _initWebView();
  }

  /// 注入安全区域 CSS 变量到 WebView
  void _injectSafeAreaInsets() {
    if (_controller == null) return;

    // 获取底部安全区域高度
    final bottomPadding = MediaQuery.of(context).padding.bottom;

    // 注入 CSS 样式覆盖 safe-area-inset-bottom
    _controller!.runJavaScript('''
      (function() {
        const style = document.createElement('style');
        style.id = 'flutter-safe-area-override';
        style.textContent = `
          .safe-area-bottom {
            padding-bottom: ${bottomPadding}px !important;
          }
        `;
        document.head.appendChild(style);
      })();
    ''');
  }

  void _reloadWebView() {
    setState(() {
      _hasError = false;
    });
    _controller?.reload();
  }

  /// 从 WebView 接收主题变化，更新状态栏样式
  void _updateThemeFromWeb(String theme) {
    final brightness = theme == 'dark' ? Brightness.dark : Brightness.light;
    final isDark = brightness == Brightness.dark;

    // 更新 ThemeStore
    final themeStore = context.read<ThemeStore>();
    themeStore.setMode(
      theme == 'dark'
          ? AppThemeMode.dark
          : theme == 'light'
          ? AppThemeMode.light
          : AppThemeMode.system,
    );

    // 更新状态栏：背景色与 web 端 bg-background 保持一致
    SystemChrome.setSystemUIOverlayStyle(
      SystemUiOverlayStyle(
        statusBarColor: isDark
            ? AppColors.darkBackground
            : AppColors.lightBackground,
        statusBarIconBrightness: isDark ? Brightness.light : Brightness.dark,
        statusBarBrightness: isDark ? Brightness.dark : Brightness.light,
      ),
    );
  }

  // 处理返回键
  Future<bool> _onWillPop() async {
    if (_controller != null) {
      final canGoBack = await _controller!.canGoBack();
      if (canGoBack) {
        _controller!.goBack();
        return false; // 拦截返回键
      }
    }
    return true; // 允许退出
  }

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final authStore = context.watch<AuthStore>();

    // 监听认证状态变化，如果未认证则跳转到登录页
    if (authStore.authState == AuthState.unauthenticated) {
      // 清除 WebView 状态
      _controller = null;
      _webUrl = null;

      // 使用 WidgetsBinding 在下一帧导航
      WidgetsBinding.instance.addPostFrameCallback((_) {
        context.go('/login');
      });

      // 返回空白页面等待导航
      return Scaffold(
        backgroundColor: AppColors.getBackground(isDark),
        body: const Center(
          child: CircularProgressIndicator(color: AppColors.primary),
        ),
      );
    }

    // 检查认证中显示加载状态
    if (_isLoading && _webUrl == null) {
      return Scaffold(
        backgroundColor: AppColors.getBackground(isDark),
        body: Center(
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              const CircularProgressIndicator(color: AppColors.primary),
              const SizedBox(height: 12),
              Text(
                '正在检查登录状态...',
                style: TextStyle(
                  color: AppColors.getTextSecondary(isDark),
                  fontSize: 14,
                ),
              ),
            ],
          ),
        ),
      );
    }

    return PopScope(
      canPop: false,
      onPopInvokedWithResult: (didPop, result) async {
        if (didPop) return;

        // 检查 WebView 是否可以后退
        if (_controller != null) {
          final canGoBack = await _controller!.canGoBack();
          if (canGoBack) {
            _controller!.goBack();
            return;
          }
        }

        // 如果不能后退，退出应用
        SystemNavigator.pop();
      },
      child: Scaffold(
        backgroundColor: AppColors.getBackground(isDark),
        body: SafeArea(
          child: Stack(
            children: [
              // WebView
              if (_webUrl != null && _webUrl!.isNotEmpty && _controller != null)
                WebViewWidget(controller: _controller!),

              // 加载指示器
              if (_isLoading)
                Positioned(
                  top: 0,
                  left: 0,
                  right: 0,
                  child: LinearProgressIndicator(
                    backgroundColor: Colors.transparent,
                    valueColor: AlwaysStoppedAnimation<Color>(
                      AppColors.primary,
                    ),
                  ),
                ),

              // 服务器配置弹窗（仅在连接失败时显示）
              if (_hasError)
                Positioned(
                  bottom: 0,
                  left: 0,
                  right: 0,
                  child: Container(
                    decoration: BoxDecoration(
                      color: AppColors.getCard(isDark),
                      borderRadius: const BorderRadius.vertical(
                        top: Radius.circular(24),
                      ),
                      boxShadow: [
                        BoxShadow(
                          color: Colors.black.withOpacity(0.2),
                          blurRadius: 20,
                        ),
                      ],
                    ),
                    padding: const EdgeInsets.fromLTRB(20, 20, 20, 24),
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          '服务器配置',
                          style: TextStyle(
                            fontSize: 18,
                            fontWeight: FontWeight.w600,
                            color: AppColors.getText(isDark),
                          ),
                        ),
                        const SizedBox(height: 4),
                        Text(
                          '请确认桌面端已启动，并使用显示的局域网地址。',
                          style: TextStyle(
                            fontSize: 14,
                            color: AppColors.getTextSecondary(isDark),
                          ),
                        ),

                        const SizedBox(height: 16),

                        TextField(
                          controller: TextEditingController(text: _draftUrl),
                          onChanged: (value) {
                            _draftUrl = value;
                          },
                          decoration: InputDecoration(
                            hintText: 'http://192.168.x.x:11054',
                            hintStyle: TextStyle(
                              color: AppColors.getTextSecondary(isDark),
                            ),
                            filled: true,
                            fillColor: isDark
                                ? const Color(0xFF2C2C2E)
                                : Colors.white,
                            border: OutlineInputBorder(
                              borderRadius: BorderRadius.circular(12),
                              borderSide: BorderSide(
                                color: AppColors.getBorder(isDark),
                              ),
                            ),
                          ),
                          keyboardType: TextInputType.url,
                        ),

                        const SizedBox(height: 16),

                        Row(
                          children: [
                            Expanded(
                              child: GestureDetector(
                                onTap: _reloadWebView,
                                child: Container(
                                  height: 48,
                                  decoration: BoxDecoration(
                                    borderRadius: BorderRadius.circular(12),
                                    border: Border.all(
                                      color: AppColors.getBorder(isDark),
                                    ),
                                  ),
                                  child: Center(
                                    child: Text(
                                      '重试',
                                      style: TextStyle(
                                        fontSize: 16,
                                        fontWeight: FontWeight.w500,
                                        color: AppColors.getText(isDark),
                                      ),
                                    ),
                                  ),
                                ),
                              ),
                            ),
                            const SizedBox(width: 12),
                            Expanded(
                              child: GestureDetector(
                                onTap: _saveWebUrl,
                                child: Container(
                                  height: 48,
                                  decoration: BoxDecoration(
                                    color: AppColors.primary,
                                    borderRadius: BorderRadius.circular(12),
                                  ),
                                  child: const Center(
                                    child: Text(
                                      '保存并连接',
                                      style: TextStyle(
                                        fontSize: 16,
                                        fontWeight: FontWeight.w500,
                                        color: Colors.white,
                                      ),
                                    ),
                                  ),
                                ),
                              ),
                            ),
                          ],
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
