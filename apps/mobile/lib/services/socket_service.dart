import 'dart:async';
import 'package:socket_io_client/socket_io_client.dart' as io;
import 'storage_service.dart';

/// Socket 服务
class SocketService {
  static io.Socket? _socket;
  static bool _connecting = false;
  static final Map<String, List<void Function(dynamic)>> _listeners = {};

  /// 连接 Socket
  static Future<io.Socket> connect() async {
    if (_socket?.connected ?? false) {
      return _socket!;
    }

    if (_connecting) {
      // 等待正在进行的连接
      return _waitForConnection();
    }

    _connecting = true;
    final baseUrl = await StorageService.getServerUrl();
    final token = await StorageService.getToken();

    _socket = io.io(
      baseUrl,
      io.OptionBuilder()
          .setTransports(['websocket', 'polling'])
          .setAuth({'token': token})
          .enableReconnection()
          .setReconnectionAttempts(10)
          .setReconnectionDelay(1000)
          .setReconnectionDelayMax(5000)
          .build(),
    );

    final completer = Completer<io.Socket>();

    _socket!.onConnect((_) {
      _connecting = false;
      completer.complete(_socket!);
    });

    _socket!.onConnectError((error) {
      _connecting = false;
      completer.completeError(error);
    });

    _socket!.onDisconnect((_) {
      print('[Socket] 已断开连接');
    });

    return completer.future;
  }

  /// 等待连接完成
  static Future<io.Socket> _waitForConnection() async {
    for (int i = 0; i < 100; i++) {
      await Future.delayed(Duration(milliseconds: 100));
      if (_socket?.connected ?? false) {
        return _socket!;
      }
    }
    throw Exception('连接超时');
  }

  /// 断开连接
  static void disconnect() {
    if (_socket != null) {
      _socket!.disconnect();
      _socket = null;
    }
  }

  /// 获取 Socket 实例
  static io.Socket? getSocket() => _socket;

  /// 是否已连接
  static bool isConnected() => _socket?.connected ?? false;

  /// 发送事件
  static void emit(String event, dynamic data) {
    if (_socket?.connected ?? false) {
      _socket!.emit(event, data);
    } else {
      print('[Socket] 未连接，无法发送事件: $event');
    }
  }

  /// 监听事件
  static void on(String event, void Function(dynamic) callback) {
    if (_socket != null) {
      _socket!.on(event, callback);
      _listeners[event] = _listeners[event] ?? [];
      _listeners[event]!.add(callback);
    }
  }

  /// 移除事件监听
  static void off(String event, void Function(dynamic)? callback) {
    if (_socket != null) {
      if (callback != null) {
        _socket!.off(event, callback);
        _listeners[event]?.remove(callback);
      } else {
        _socket!.off(event);
        _listeners[event]?.clear();
      }
    }
  }

  /// 监听一次事件
  static void once(String event, void Function(dynamic) callback) {
    if (_socket != null) {
      _socket!.once(event, callback);
    }
  }

  /// 清除所有监听器
  static void clearListeners() {
    for (final event in _listeners.keys) {
      for (final callback in _listeners[event]!) {
        _socket?.off(event, callback);
      }
    }
    _listeners.clear();
  }
}