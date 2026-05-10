import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';
import 'stores/auth_store.dart';
import 'stores/chat_store.dart';
import 'stores/socket_store.dart';
import 'stores/chat_room_store.dart';
import 'stores/theme_store.dart';
import 'pages/login_page.dart';
import 'pages/home_page.dart';
import 'pages/chat_page.dart';
import 'pages/agent_page.dart';
import 'constants/colors.dart';

/// 状态栏样式包装器 - 跟随主题动态变化
class _StatusBarWrapper extends StatefulWidget {
  final Widget child;

  const _StatusBarWrapper({required this.child});

  @override
  State<_StatusBarWrapper> createState() => _StatusBarWrapperState();
}

class _StatusBarWrapperState extends State<_StatusBarWrapper>
    with WidgetsBindingObserver {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _updateStatusBar();
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  void didChangePlatformBrightness() {
    _updateStatusBar();
  }

  void _updateStatusBar() {
    final themeStore = context.read<ThemeStore>();
    final brightness = themeStore.currentBrightness;
    final isDark = brightness == Brightness.dark;

    SystemChrome.setSystemUIOverlayStyle(
      SystemUiOverlayStyle(
        statusBarColor: isDark ? AppColors.darkBackground : AppColors.lightBackground,
        statusBarIconBrightness: isDark ? Brightness.light : Brightness.dark,
        statusBarBrightness: isDark ? Brightness.dark : Brightness.light,
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    // 监听主题变化
    context.watch<ThemeStore>();
    _updateStatusBar();
    return widget.child;
  }
}

/// 路由配置
final GoRouter _router = GoRouter(
  routes: [
    GoRoute(
      path: '/',
      builder: (context, state) => const HomePage(),
    ),
    GoRoute(
      path: '/login',
      builder: (context, state) => const LoginPage(),
    ),
    GoRoute(
      path: '/chat/:id',
      builder: (context, state) {
        final id = state.pathParameters['id']!;
        return ChatPage(chatRoomId: id);
      },
    ),
    GoRoute(
      path: '/agent/:id',
      builder: (context, state) {
        final id = state.pathParameters['id']!;
        return AgentPage(agentId: id);
      },
    ),
  ],
  redirect: (context, state) {
    final authStore = context.read<AuthStore>();
    final authState = authStore.authState;
    final isLoginRoute = state.matchedLocation == '/login';

    // 正在检查认证状态时，不重定向
    if (authState == AuthState.checking) {
      return null;
    }

    final isAuthenticated = authState == AuthState.authenticated;

    if (!isAuthenticated && !isLoginRoute) {
      return '/login';
    }

    if (isAuthenticated && isLoginRoute) {
      return '/';
    }

    return null;
  },
);

/// 应用入口
class App extends StatefulWidget {
  const App({super.key});

  @override
  State<App> createState() => _AppState();
}

class _AppState extends State<App> {
  AuthStore? _authStore;
  bool _initialized = false;

  @override
  void initState() {
    super.initState();
    _initAuth();
  }

  Future<void> _initAuth() async {
    // 创建 AuthStore 并立即检查认证状态
    _authStore = AuthStore();
    await _authStore!.checkAuth();
    setState(() {
      _initialized = true;
    });
  }

  @override
  Widget build(BuildContext context) {
    // 未初始化完成时显示加载页面
    if (!_initialized || _authStore == null) {
      return MaterialApp(
        title: 'TeamAgentX',
        debugShowCheckedModeBanner: false,
        home: Scaffold(
          backgroundColor: AppColors.lightBackground,
          body: const Center(
            child: CircularProgressIndicator(color: AppColors.primary),
          ),
        ),
      );
    }

    return MultiProvider(
      providers: [
        ChangeNotifierProvider.value(value: _authStore!),
        ChangeNotifierProvider(create: (_) => ChatStore()),
        ChangeNotifierProvider(create: (_) => SocketStore()),
        ChangeNotifierProvider(create: (_) => ChatRoomStore()),
        ChangeNotifierProvider(create: (_) => ThemeStore()),
      ],
      child: Consumer<ThemeStore>(
        builder: (context, themeStore, child) {
          return _StatusBarWrapper(
            child: MaterialApp.router(
              title: 'TeamAgentX',
              debugShowCheckedModeBanner: false,
              theme: ThemeData(
                brightness: Brightness.light,
                primaryColor: AppColors.primary,
                scaffoldBackgroundColor: AppColors.lightBackground,
                appBarTheme: const AppBarTheme(
                  backgroundColor: AppColors.lightBackground,
                  foregroundColor: AppColors.lightText,
                ),
                useMaterial3: true,
              ),
              darkTheme: ThemeData(
                brightness: Brightness.dark,
                primaryColor: AppColors.primary,
                scaffoldBackgroundColor: AppColors.darkBackground,
                appBarTheme: const AppBarTheme(
                  backgroundColor: AppColors.darkBackground,
                  foregroundColor: AppColors.darkText,
                ),
                useMaterial3: true,
              ),
              themeMode: themeStore.themeMode,
              routerConfig: _router,
            ),
          );
        },
      ),
    );
  }
}