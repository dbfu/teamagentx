import 'dart:convert';
import 'package:dio/dio.dart';
import '../models/models.dart';
import 'storage_service.dart';

/// API 客户端
class ApiClient {
  static Dio? _dio;
  static const int _timeoutMs = 10000;

  /// 初始化 Dio
  static Future<void> init() async {
    _dio = Dio(BaseOptions(
      connectTimeout: Duration(milliseconds: _timeoutMs),
      receiveTimeout: Duration(milliseconds: _timeoutMs),
      sendTimeout: Duration(milliseconds: _timeoutMs),
    ));
  }

  /// 获取基础 URL
  static Future<String> _getBaseUrl() async {
    return StorageService.getServerUrl();
  }

  /// 获取请求头
  static Future<Map<String, String>> _getHeaders(bool skipAuth) async {
    final token = await StorageService.getToken();
    return {
      if (!skipAuth && token != null) 'Authorization': 'Bearer $token',
    };
  }

  /// 通用请求
  static Future<ApiResponse<T>> request<T>(
    String endpoint,
    {
    String method = 'GET',
    dynamic data,
    bool skipAuth = false,
    T Function(Map<String, dynamic>)? fromJsonT,
  }) async {
    try {
      final baseUrl = await _getBaseUrl();
      if (baseUrl.isEmpty) {
        return ApiResponse(success: false, error: '服务器地址未设置');
      }

      final headers = await _getHeaders(skipAuth);
      final url = '$baseUrl$endpoint';

      final options = Options(
        headers: headers,
        contentType: 'application/json',
        method: method,
      );

      final response = await _dio!.request<dynamic>(
        url,
        data: data != null ? jsonEncode(data) : null,
        options: options,
      );

      final responseData = response.data as Map<String, dynamic>;

      if (fromJsonT != null && responseData['data'] != null) {
        return ApiResponse(
          success: responseData['success'] ?? false,
          data: fromJsonT(responseData['data']),
          error: responseData['error'],
        );
      }

      return ApiResponse(
        success: responseData['success'] ?? false,
        error: responseData['error'],
      );
    } on DioException catch (e) {
      String errorMsg = '网络请求失败';
      if (e.type == DioExceptionType.connectionTimeout ||
          e.type == DioExceptionType.receiveTimeout) {
        errorMsg = '请求超时，请检查服务器地址或网络连接';
      } else if (e.type == DioExceptionType.connectionError) {
        errorMsg = '无法连接服务器';
      }
      return ApiResponse(success: false, error: errorMsg);
    } catch (e) {
      return ApiResponse(success: false, error: e.toString());
    }
  }

  /// 请求列表数据
  static Future<ApiResponse<List<T>>> requestList<T>(
    String endpoint,
    {
    String method = 'GET',
    dynamic data,
    bool skipAuth = false,
    T Function(Map<String, dynamic>)? fromJsonT,
  }) async {
    try {
      final baseUrl = await _getBaseUrl();
      if (baseUrl.isEmpty) {
        return ApiResponse(success: false, error: '服务器地址未设置');
      }

      final headers = await _getHeaders(skipAuth);
      final url = '$baseUrl$endpoint';

      final options = Options(
        headers: headers,
        contentType: 'application/json',
        method: method,
      );

      final response = await _dio!.request<dynamic>(
        url,
        data: data != null ? jsonEncode(data) : null,
        options: options,
      );

      final responseData = response.data as Map<String, dynamic>;
      final dataList = responseData['data'] as List?;

      if (fromJsonT != null && dataList != null) {
        return ApiResponse(
          success: responseData['success'] ?? false,
          data: dataList.map((e) => fromJsonT(e)).toList(),
          error: responseData['error'],
        );
      }

      return ApiResponse(
        success: responseData['success'] ?? false,
        data: [],
        error: responseData['error'],
      );
    } on DioException catch (e) {
      String errorMsg = '网络请求失败';
      if (e.type == DioExceptionType.connectionTimeout ||
          e.type == DioExceptionType.receiveTimeout) {
        errorMsg = '请求超时';
      }
      return ApiResponse(success: false, error: errorMsg);
    } catch (e) {
      return ApiResponse(success: false, error: e.toString());
    }
  }

  /// 上传图片
  static Future<ApiResponse<UploadResult>> uploadImage(
    String filePath,
    String mimeType,
    String filename,
  ) async {
    try {
      final baseUrl = await _getBaseUrl();
      final token = await StorageService.getToken();
      final url = '$baseUrl/upload/image';

      final formData = FormData.fromMap({
        'file': await MultipartFile.fromFile(filePath, filename: filename),
      });

      final response = await _dio!.post(
        url,
        data: formData,
        options: Options(
          headers: {
            if (token != null) 'Authorization': 'Bearer $token',
          },
        ),
      );

      final responseData = response.data as Map<String, dynamic>;

      if (responseData['success'] && responseData['data'] != null) {
        return ApiResponse(
          success: true,
          data: UploadResult.fromJson(responseData['data']),
        );
      }

      return ApiResponse(success: false, error: responseData['error']);
    } catch (e) {
      return ApiResponse(success: false, error: '图片上传失败');
    }
  }
}

/// 认证 API
class AuthApi {
  /// 检查是否首次使用
  static Future<ApiResponse<Map<String, bool>>> checkFirstUse() async {
    return ApiClient.request(
      '/auth/check-first-use',
      skipAuth: true,
      fromJsonT: (json) => {'isFirstUse': json['isFirstUse'] ?? true},
    );
  }

  /// 注册
  static Future<ApiResponse<Map<String, dynamic>>> register({
    required String username,
    required String password,
    String? avatar,
  }) async {
    return ApiClient.request(
      '/auth/register',
      method: 'POST',
      data: {'username': username, 'password': password, 'avatar': avatar},
      skipAuth: true,
    );
  }

  /// 登录
  static Future<ApiResponse<Map<String, dynamic>>> login({
    required String username,
    required String password,
  }) async {
    return ApiClient.request(
      '/auth/login',
      method: 'POST',
      data: {'username': username, 'password': password},
      skipAuth: true,
    );
  }

  /// 获取当前用户
  static Future<ApiResponse<User>> me() async {
    return ApiClient.request(
      '/auth/me',
      fromJsonT: User.fromJson,
    );
  }
}

/// Agent API
class AgentApi {
  /// 获取所有助手
  static Future<ApiResponse<List<Agent>>> getAll() async {
    return ApiClient.requestList(
      '/agents',
      fromJsonT: Agent.fromJson,
    );
  }

  /// 获取活跃助手
  static Future<ApiResponse<List<Agent>>> getActive() async {
    return ApiClient.requestList(
      '/agents/active',
      fromJsonT: Agent.fromJson,
    );
  }

  /// 获取单个助手
  static Future<ApiResponse<Agent>> getById(String id) async {
    return ApiClient.request(
      '/agents/$id',
      fromJsonT: Agent.fromJson,
    );
  }

  /// 创建快速对话
  static Future<ApiResponse<ChatRoom>> createQuickChat(
    String agentId,
    String userId,
    String? customWorkDir,
  ) async {
    return ApiClient.request(
      '/agents/quick-chat',
      method: 'POST',
      data: {
        'agentId': agentId,
        'userId': userId,
        'customWorkDir': customWorkDir,
      },
      fromJsonT: ChatRoom.fromJson,
    );
  }
}

/// ChatRoom API
class ChatRoomApi {
  /// 获取所有聊天室
  static Future<ApiResponse<List<ChatRoom>>> getAll() async {
    return ApiClient.requestList(
      '/chatrooms',
      fromJsonT: ChatRoom.fromJson,
    );
  }

  /// 获取单个聊天室
  static Future<ApiResponse<ChatRoom>> getById(String id) async {
    return ApiClient.request(
      '/chatrooms/$id',
      fromJsonT: ChatRoom.fromJson,
    );
  }

  /// 创建聊天室
  static Future<ApiResponse<ChatRoom>> create({
    required String name,
    String? avatar,
    String? avatarColor,
    String? description,
  }) async {
    return ApiClient.request(
      '/chatrooms',
      method: 'POST',
      data: {
        'name': name,
        'avatar': avatar,
        'avatarColor': avatarColor,
        'description': description,
      },
      fromJsonT: ChatRoom.fromJson,
    );
  }

  /// 删除聊天室
  static Future<ApiResponse<void>> delete(String id) async {
    return ApiClient.request(
      '/chatrooms/$id',
      method: 'DELETE',
    );
  }
}

/// Message API
class MessageApi {
  /// 获取消息列表
  static Future<ApiResponse<List<Message>>> getAll(String? chatRoomId) async {
    final endpoint =
        chatRoomId != null ? '/messages?chatRoomId=$chatRoomId' : '/messages';
    return ApiClient.requestList(
      endpoint,
      fromJsonT: Message.fromJson,
    );
  }

  /// 清空聊天室消息
  static Future<ApiResponse<void>> clearByChatRoomId(String chatRoomId) async {
    return ApiClient.request(
      '/messages/chatroom/$chatRoomId',
      method: 'DELETE',
    );
  }
}