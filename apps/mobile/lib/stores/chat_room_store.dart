import 'package:flutter/foundation.dart';
import '../models/models.dart';
import '../services/api_client.dart';

/// 聊天室状态管理
class ChatRoomStore extends ChangeNotifier {
  List<ChatRoom> _chatRooms = [];
  String? _selectedRoomId;
  bool _loading = false;

  List<ChatRoom> get chatRooms => _chatRooms;
  String? get selectedRoomId => _selectedRoomId;
  bool get loading => _loading;

  /// 加载聊天室列表
  Future<void> loadChatRooms() async {
    _loading = true;
    notifyListeners();

    try {
      final response = await ChatRoomApi.getAll();
      if (response.success && response.data != null) {
        _chatRooms = response.data!;
      }
      _loading = false;
      notifyListeners();
    } catch (e) {
      _loading = false;
      notifyListeners();
    }
  }

  /// 选择聊天室
  void selectRoom(String? id) {
    _selectedRoomId = id;
    notifyListeners();
  }

  /// 添加聊天室
  void addRoom(ChatRoom room) {
    _chatRooms = [room, ..._chatRooms];
    notifyListeners();
  }

  /// 移除聊天室
  void removeRoom(String id) {
    _chatRooms = _chatRooms.where((room) => room.id != id).toList();
    if (_selectedRoomId == id) {
      _selectedRoomId = null;
    }
    notifyListeners();
  }

  /// 更新聊天室
  void updateRoom(ChatRoom room) {
    _chatRooms = _chatRooms.map((r) => r.id == room.id ? room : r).toList();
    notifyListeners();
  }

  /// 创建聊天室
  Future<Map<String, dynamic>> createRoom(String name, String? description) async {
    try {
      final response = await ChatRoomApi.create(
        name: name,
        description: description,
      );

      if (response.success && response.data != null) {
        _chatRooms = [response.data!, ..._chatRooms];
        notifyListeners();
        return {'success': true};
      }

      return {'success': false, 'error': response.error ?? '创建失败'};
    } catch (e) {
      return {'success': false, 'error': '网络错误'};
    }
  }

  /// 删除聊天室
  Future<void> deleteRoom(String id) async {
    try {
      await ChatRoomApi.delete(id);
      _chatRooms = _chatRooms.where((room) => room.id != id).toList();
      if (_selectedRoomId == id) {
        _selectedRoomId = null;
      }
      notifyListeners();
    } catch (e) {
      // 忽略删除错误
    }
  }

  /// 设置聊天室列表
  void setChatRooms(List<ChatRoom> rooms) {
    _chatRooms = rooms;
    notifyListeners();
  }

  /// 获取指定聊天室
  ChatRoom? getRoomById(String id) {
    return _chatRooms.firstWhereOrNull((r) => r.id == id);
  }
}

/// List 扩展
extension ListExtension<T> on List<T> {
  T? firstWhereOrNull(bool Function(T) test) {
    for (final element in this) {
      if (test(element)) return element;
    }
    return null;
  }
}