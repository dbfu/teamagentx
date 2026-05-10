import 'package:flutter/material.dart';

/// 主题模式：跟随系统、浅色、深色
enum AppThemeMode {
  system,
  light,
  dark,
}

/// 主题状态管理
class ThemeStore extends ChangeNotifier {
  AppThemeMode _mode = AppThemeMode.system;

  AppThemeMode get mode => _mode;

  /// 获取当前实际生效的 ThemeMode（用于 MaterialApp）
  ThemeMode get themeMode {
    switch (_mode) {
      case AppThemeMode.light:
        return ThemeMode.light;
      case AppThemeMode.dark:
        return ThemeMode.dark;
      case AppThemeMode.system:
        return ThemeMode.system;
    }
  }

  /// 获取当前亮度（考虑系统主题）
  Brightness get currentBrightness {
    if (_mode == AppThemeMode.system) {
      // 返回 null 表示需要从 WidgetsBinding 获取
      return WidgetsBinding.instance.platformDispatcher.platformBrightness;
    }
    return _mode == AppThemeMode.dark ? Brightness.dark : Brightness.light;
  }

  /// 设置主题模式
  void setMode(AppThemeMode mode) {
    if (_mode != mode) {
      _mode = mode;
      notifyListeners();
    }
  }

  /// 切换主题（循环切换：system -> light -> dark -> system）
  void toggle() {
    final next = {
      AppThemeMode.system: AppThemeMode.light,
      AppThemeMode.light: AppThemeMode.dark,
      AppThemeMode.dark: AppThemeMode.system,
    }[_mode]!;
    setMode(next);
  }
}