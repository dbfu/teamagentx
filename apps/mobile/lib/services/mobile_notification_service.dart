import 'package:flutter/services.dart';

class MobileNotificationService {
  static const MethodChannel _channel = MethodChannel('teamagentx/notifications');
  static Future<void> Function(String chatRoomId)? _onOpenChatRoom;

  static void setOpenChatRoomHandler(
    Future<void> Function(String chatRoomId)? handler,
  ) {
    _onOpenChatRoom = handler;
    _channel.setMethodCallHandler((call) async {
      if (call.method != 'notificationOpened') return null;

      final args = call.arguments;
      if (args is! Map) return null;

      final chatRoomId = args['chatRoomId'];
      if (chatRoomId is String && chatRoomId.isNotEmpty) {
        await _onOpenChatRoom?.call(chatRoomId);
      }
      return null;
    });
  }

  static Future<void> setBadgeCount(int count) async {
    final normalizedCount = count > 0 ? count : 0;
    try {
      await _channel.invokeMethod<void>('setBadgeCount', {
        'count': normalizedCount,
      });
    } catch (error) {
      // 平台不支持 badge 时保留应用内未读数，不影响聊天主流程。
      print('[Notification] setBadgeCount failed: $error');
    }
  }

  static Future<void> showMessage({
    required String title,
    required String body,
    String? chatRoomId,
    int count = 0,
  }) async {
    try {
      await _channel.invokeMethod<void>('showMessage', {
        'title': title,
        'body': body.isEmpty ? '有新消息' : body,
        'chatRoomId': chatRoomId,
        'count': count > 0 ? count : 0,
      });
    } catch (error) {
      print('[Notification] showMessage failed: $error');
    }
  }
}
