import 'package:flutter/material.dart';

/// 颜色配置 - 与 web 端 Tailwind CSS 变量保持一致
class AppColors {
  // 主色
  static const Color primary = Color(0xFF6366F1);
  static const Color primaryLight = Color(0xFF818CF8);
  static const Color primaryDark = Color(0xFF4F46E5);

  // 辅助色
  static const Color secondary = Color(0xFF8B5CF6);

  // 状态色
  static const Color success = Color(0xFF34C759);
  static const Color warning = Color(0xFFFF9500);
  static const Color error = Color(0xFFFF3B30);
  static const Color info = Color(0xFF007AFF);

  // 浅色模式 - 对应 web 端 :root 变量
  static const Color lightBackground = Color(0xFFFFFFFF); // oklch(1 0 0)
  static const Color lightCard = Color(0xFFFFFFFF); // oklch(1 0 0)
  static const Color lightText = Color(0xFF1C1C1E); // oklch(0.274 0.006 260)
  static const Color lightTextSecondary = Color(0xFF8E8E93);
  static const Color lightBorder = Color(0xFFE5E5EA);

  // 深色模式 - 对应 web 端 .dark 变量
  // --background: 实际值为 #0a0a0a
  static const Color darkBackground = Color(0xFF0A0A0A);
  // --sidebar: oklch(0.205 0 0) ≈ #343434（侧边栏）
  static const Color darkCard = Color(0xFF343434);
  // 状态栏背景色 - 与 background 一致
  static const Color darkStatusBar = Color(0xFF0A0A0A);
  static const Color darkText = Color(0xFFF5F5F7); // oklch(0.985 0 0)
  static const Color darkTextSecondary = Color(0xFF8E8E93);
  static const Color darkBorder = Color(0xFF2C2C2E);

  // 获取主题色
  static Color getBackground(bool isDark) =>
      isDark ? darkBackground : lightBackground;
  static Color getCard(bool isDark) => isDark ? darkCard : lightCard;
  static Color getText(bool isDark) => isDark ? darkText : lightText;
  static Color getTextSecondary(bool isDark) =>
      isDark ? darkTextSecondary : lightTextSecondary;
  static Color getBorder(bool isDark) => isDark ? darkBorder : lightBorder;
}