import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:go_router/go_router.dart';
import 'package:webview_flutter/webview_flutter.dart';
import 'package:provider/provider.dart';
import 'package:url_launcher/url_launcher.dart';
import '../stores/auth_store.dart';
import '../stores/theme_store.dart';
import '../services/mobile_notification_service.dart';
import '../services/storage_service.dart';
import '../constants/colors.dart';

/// 主页（WebView）
class HomePage extends StatefulWidget {
  const HomePage({super.key});

  @override
  State<HomePage> createState() => _HomePageState();
}

class _HomePageState extends State<HomePage> with WidgetsBindingObserver {
  String? _webUrl;
  String? _token;
  bool _isLoading = true;
  bool _hasError = false;
  String _draftUrl = '';
  WebViewController? _controller;

  // 连接失败时自动重试；超过上限跳到扫码页重新配置/登录
  static const int _maxAutoRetries = 3;
  int _retryCount = 0;
  bool _isRetrying = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    MobileNotificationService.setOpenChatRoomHandler(_openChatRoomFromNotification);
    WidgetsBinding.instance.addPostFrameCallback((_) {
      _init();
    });
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    MobileNotificationService.setOpenChatRoomHandler(null);
    // 清理 WebView 控制器
    _controller = null;
    super.dispose();
  }

  /// App 从后台回到前台时，WebView 内容可能已被系统回收（iOS WebContent
  /// 进程被回收 / Android surface 丢失），表现为白屏。这里检测页面是否变空，
  /// 变空则重新加载。token 存在 localStorage、当前路由在 URL 中，reload 可
  /// 恢复到原页面。
  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    super.didChangeAppLifecycleState(state);
    if (state == AppLifecycleState.resumed) {
      _recoverWebViewIfBlank();
    }
  }

  Future<void> _recoverWebViewIfBlank() async {
    final controller = _controller;
    if (controller == null) return;
    if (_webUrl == null || _webUrl!.isEmpty) return;
    // 处于错误状态时由错误 UI 处理，正在加载时无需干预
    if (_hasError || _isLoading) return;

    try {
      final result = await controller.runJavaScriptReturningResult(
        'document.getElementById("root") ? document.getElementById("root").childElementCount : 0',
      );
      if (_parseJsInt(result) <= 0) {
        controller.reload();
      }
    } catch (_) {
      // JS 上下文已失效（WebContent 进程被回收），直接重载
      controller.reload();
    }
  }

  int _parseJsInt(Object? result) {
    if (result is int) return result;
    if (result is num) return result.toInt();
    if (result is String) return int.tryParse(result) ?? 0;
    return 0;
  }

  /// WebView 主框架加载失败：先自动重试，超过上限则跳到扫码页重新配置/登录。
  void _handleWebViewError() {
    if (!mounted || _isRetrying) return;

    if (_retryCount >= _maxAutoRetries) {
      _goToScanPage();
      return;
    }

    _retryCount++;
    _isRetrying = true;
    setState(() {
      _isLoading = true;
      _hasError = false;
    });

    // 间隔随次数递增，缓解瞬时网络问题导致的连续失败
    Future.delayed(Duration(milliseconds: 800 * _retryCount), () {
      if (!mounted) return;
      _isRetrying = false;
      _controller?.reload();
    });
  }

  /// 自动重试多次仍失败，跳回扫码页（即登录页），让用户重新扫码配置服务器。
  Future<void> _goToScanPage() async {
    _retryCount = 0;
    _isRetrying = false;
    _controller = null;
    _webUrl = null;
    _token = null;

    await StorageService.deleteToken();

    if (!mounted) return;
    // 置为未认证后，build() 会自动导航到 /login（扫码页）
    final authStore = context.read<AuthStore>();
    await authStore.logout();
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
            // 加载成功，重置重试状态
            _retryCount = 0;
            _isRetrying = false;
            setState(() {
              _isLoading = false;
              _hasError = false;
            });
            // 注入安全区域 CSS 变量
            _injectSafeAreaInsets();
            _injectExternalLinkHandler();
          },
          onWebResourceError: (error) {
            // 只处理主框架加载失败，忽略图片/favicon 等子资源错误
            if (error.isForMainFrame == false) return;
            _handleWebViewError();
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
            } else if (type == 'notification:setBadgeCount') {
              final count = payload['count'];
              MobileNotificationService.setBadgeCount(count is int ? count : 0);
            } else if (type == 'notification:showMessage') {
              MobileNotificationService.showMessage(
                title: payload['title']?.toString() ?? 'TeamAgentX',
                body: payload['body']?.toString() ?? '有新消息',
                chatRoomId: payload['chatRoomId']?.toString(),
                count: payload['count'] is int ? payload['count'] as int : 0,
              );
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

  Future<void> _openChatRoomFromNotification(String chatRoomId) async {
    if (_webUrl == null || _webUrl!.isEmpty) return;

    final uri = Uri.parse(_webUrl!);
    final target = uri.replace(
      path: '/',
      queryParameters: {'room': chatRoomId},
      fragment: '',
    );

    if (_controller == null) {
      _webUrl = target.toString();
      return;
    }

    await _controller!.loadRequest(target);
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
