import 'package:shared_preferences/shared_preferences.dart';
import '../constants/keys.dart';

/// 存储服务
class StorageService {
  static SharedPreferences? _prefs;

  /// 初始化
  static Future<void> init() async {
    _prefs = await SharedPreferences.getInstance();
  }

  /// 规范化服务器地址
  static String _normalizeUrl(String url) {
    final normalized = url.trim().replaceAll(RegExp(r'/+$'), '');
    if (normalized.isEmpty) return '';
    if (!RegExp(r'^https?://', caseSensitive: false).hasMatch(normalized)) {
      return 'http://$normalized';
    }
    return normalized;
  }

  /// 获取服务器地址
  static Future<String> getServerUrl() async {
    try {
      final url = _prefs?.getString(StorageKeys.serverUrl);
      if (url != null && url.isNotEmpty) {
        return _normalizeUrl(url);
      }
      return '';
    } catch (e) {
      return '';
    }
  }

  /// 设置服务器地址
  static Future<void> setServerUrl(String url) async {
    await _prefs?.setString(StorageKeys.serverUrl, _normalizeUrl(url));
  }

  /// 获取认证 Token
  static Future<String?> getToken() async {
    try {
      return _prefs?.getString(StorageKeys.authToken);
    } catch (e) {
      return null;
    }
  }

  /// 保存认证 Token
  static Future<void> saveToken(String token) async {
    await _prefs?.setString(StorageKeys.authToken, token);
  }

  /// 删除认证 Token
  static Future<void> deleteToken() async {
    await _prefs?.remove(StorageKeys.authToken);
  }
}