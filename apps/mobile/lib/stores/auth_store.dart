import 'package:flutter/foundation.dart';
import '../models/models.dart';
import '../services/storage_service.dart';
import '../services/api_client.dart';

/// 认证状态
enum AuthState { checking, unauthenticated, authenticated }

/// 认证状态管理
class AuthStore extends ChangeNotifier {
  User? _user;
  AuthState _authState = AuthState.checking;
  bool _isLoading = false;
  bool _isFirstUse = true;

  User? get user => _user;
  AuthState get authState => _authState;
  bool get isLoading => _isLoading;
  bool get isFirstUse => _isFirstUse;

  /// 检查认证状态
  Future<void> checkAuth() async {
    print('[AuthStore] checkAuth 开始');
    _authState = AuthState.checking;
    _isLoading = true;
    notifyListeners();

    try {
      final token = await StorageService.getToken();
      print('[AuthStore] token: ${token != null ? '存在' : '不存在'}');

      if (token == null) {
        _authState = AuthState.unauthenticated;
        _isLoading = false;
        notifyListeners();
        return;
      }

      final response = await AuthApi.me();
      if (response.success && response.data != null) {
        _user = response.data;
        _authState = AuthState.authenticated;
        _isLoading = false;
        notifyListeners();
      } else {
        await StorageService.deleteToken();
        _authState = AuthState.unauthenticated;
        _isLoading = false;
        notifyListeners();
      }
    } catch (e) {
      print('[AuthStore] checkAuth 异常: $e');
      _authState = AuthState.unauthenticated;
      _isLoading = false;
      notifyListeners();
    }
  }

  /// 检查是否首次使用
  Future<void> checkFirstUse() async {
    try {
      final response = await AuthApi.checkFirstUse();
      if (response.success && response.data != null) {
        _isFirstUse = response.data!['isFirstUse'] ?? false;
        notifyListeners();
      }
    } catch (e) {
      _isFirstUse = false;
    }
  }

  /// 登录
  Future<Map<String, dynamic>> login(String username, String password) async {
    _isLoading = true;
    notifyListeners();

    try {
      final response = await AuthApi.login(
        username: username,
        password: password,
      );

      if (!response.success || response.data == null) {
        _isLoading = false;
        notifyListeners();
        return {'success': false, 'error': response.error ?? '登录失败'};
      }

      final token = response.data!['token'] as String;
      final userData = response.data!['user'] as Map<String, dynamic>;

      await StorageService.saveToken(token);

      _user = User.fromJson(userData);
      _authState = AuthState.authenticated;
      _isLoading = false;
      _isFirstUse = false;
      notifyListeners();

      return {'success': true};
    } catch (e) {
      _isLoading = false;
      notifyListeners();
      return {'success': false, 'error': '网络错误，请检查连接'};
    }
  }

  /// 二维码登录
  Future<Map<String, dynamic>> qrLogin(
    String url,
    String token,
    String username,
  ) async {
    _isLoading = true;
    notifyListeners();

    try {
      await StorageService.setServerUrl(url);
      await StorageService.saveToken(token);

      _user = User(id: '', username: username, createdAt: '');
      _authState = AuthState.authenticated;
      _isLoading = false;
      _isFirstUse = false;
      notifyListeners();

      return {'success': true};
    } catch (e) {
      _isLoading = false;
      notifyListeners();
      return {'success': false, 'error': '保存登录信息失败'};
    }
  }

  /// 注册
  Future<Map<String, dynamic>> register(
    String username,
    String password,
    String? avatar,
  ) async {
    _isLoading = true;
    notifyListeners();

    try {
      final response = await AuthApi.register(
        username: username,
        password: password,
        avatar: avatar,
      );

      if (!response.success || response.data == null) {
        _isLoading = false;
        notifyListeners();
        return {'success': false, 'error': response.error ?? '注册失败'};
      }

      final token = response.data!['token'] as String;
      final userData = response.data!['user'] as Map<String, dynamic>;

      await StorageService.saveToken(token);

      _user = User.fromJson(userData);
      _authState = AuthState.authenticated;
      _isLoading = false;
      _isFirstUse = false;
      notifyListeners();

      return {'success': true};
    } catch (e) {
      _isLoading = false;
      notifyListeners();
      return {'success': false, 'error': '网络错误'};
    }
  }

  /// 退出登录
  Future<void> logout() async {
    await StorageService.deleteToken();
    _user = null;
    _authState = AuthState.unauthenticated;
    notifyListeners();
  }
}