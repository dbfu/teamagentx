import 'package:flutter/foundation.dart';
import '../models/models.dart';
import '../services/socket_service.dart';
import 'chat_store.dart';

/// Socket 状态管理
class SocketStore extends ChangeNotifier {
  bool _isConnected = false;
  String? _currentChatRoomId;
  String? _username;
  User? _user;

  bool get isConnected => _isConnected;
  String? get currentChatRoomId => _currentChatRoomId;
  String? get username => _username;
  User? get user => _user;

  /// 连接 Socket
  Future<bool> connect(ChatStore chatStore) async {
    try {
      await SocketService.connect();
      _isConnected = true;
      notifyListeners();

      // 监听连接响应
      SocketService.on('joined', (data) {
        final jsonData = data as Map<String, dynamic>;
        _username = jsonData['username'] as String?;
        if (jsonData['user'] != null) {
          _user = User.fromJson(jsonData['user'] as Map<String, dynamic>);
        }
        notifyListeners();
      });

      // 监听新消息
      SocketService.on('message', (data) {
        final jsonData = data as Map<String, dynamic>;
        final msgChatRoomId = jsonData['chatRoomId'] as String;

        if (msgChatRoomId == _currentChatRoomId) {
          final message = Message.fromJson(jsonData);
          chatStore.addMessage(message);
        }
      });

      // 监听 Agent 打字事件
      SocketService.on('agent:typing', (data) {
        final jsonData = data as Map<String, dynamic>;
        final messageId = jsonData['messageId'] as String;
        final agentId = jsonData['agentId'] as String;
        final agentName = jsonData['agentName'] as String;

        chatStore.addTypingAgent(
          messageId,
          TypingAgent(agentId: agentId, agentName: agentName),
        );
        chatStore.setAgentStatus(agentId, AgentStatus.executing);
      });

      // 监听 Agent 完成事件
      SocketService.on('agent:done', (data) {
        final jsonData = data as Map<String, dynamic>;
        final agentId = jsonData['agentId'] as String;
        final triggerMessageId = jsonData['triggerMessageId'] as String;
        final key = '${triggerMessageId}_${agentId}';

        chatStore.removeTypingAgent(triggerMessageId, agentId);
        chatStore.markAgentComplete(key);
        chatStore.setAgentStatus(agentId, AgentStatus.idle);

        // 延迟清理流式状态
        Future.delayed(Duration(seconds: 1), () {
          chatStore.clearStreamState(key);
        });
      });

      // 监听 Agent 流式输出
      SocketService.on('agent:stream', (data) {
        final jsonData = data as Map<String, dynamic>;
        final messageId = jsonData['messageId'] as String;
        final agentId = jsonData['agentId'] as String;
        final content = jsonData['content'] as String;
        final key = '${messageId}_${agentId}';

        chatStore.appendStreamContent(key, content);
      });

      // 监听 Agent 思考过程
      SocketService.on('agent:thinking', (data) {
        final jsonData = data as Map<String, dynamic>;
        final messageId = jsonData['messageId'] as String;
        final agentId = jsonData['agentId'] as String;
        final thinking = jsonData['thinking'] as String;
        final key = '${messageId}_${agentId}';

        chatStore.appendStreamThinking(key, thinking);
      });

      // 监听 Agent 状态更新
      SocketService.on('agent:status', (data) {
        final jsonData = data as Map<String, dynamic>;
        final statuses = jsonData['statuses'] as Map<String, dynamic>;
        statuses.forEach((agentId, status) {
          final statusStr = status as String;
          chatStore.setAgentStatus(
            agentId,
            statusStr == 'idle'
                ? AgentStatus.idle
                : statusStr == 'executing'
                    ? AgentStatus.executing
                    : AgentStatus.busy,
          );
        });
      });

      // 监听未读数更新
      SocketService.on('unread:update', (data) {
        final jsonData = data as Map<String, dynamic>;
        if (jsonData['unreadCounts'] != null) {
          final counts = jsonData['unreadCounts'] as Map<String, dynamic>;
          chatStore.setUnreadCounts(
            counts.map((k, v) => MapEntry(k, v as int)),
          );
        } else if (jsonData['chatRoomId'] != null && jsonData['count'] != null) {
          chatStore.updateUnreadCount(
            jsonData['chatRoomId'] as String,
            jsonData['count'] as int,
          );
        }
      });

      // 监听聊天室加入响应
      SocketService.on('chatroom:joined', (data) {
        final jsonData = data as Map<String, dynamic>;
        final messages = (jsonData['messages'] as List?)
                ?.map((e) => Message.fromJson(e as Map<String, dynamic>))
                .toList() ??
            [];
        chatStore.setMessages(messages);
      });

      return true;
    } catch (e) {
      print('[Socket] 连接失败: $e');
      _isConnected = false;
      notifyListeners();
      return false;
    }
  }

  /// 断开连接
  void disconnect() {
    SocketService.disconnect();
    _isConnected = false;
    _currentChatRoomId = null;
    _username = null;
    _user = null;
    notifyListeners();
  }

  /// 加入聊天室
  void joinChatRoom(String chatRoomId, ChatStore chatStore) {
    if (_currentChatRoomId == chatRoomId) return;

    // 离开之前的房间
    if (_currentChatRoomId != null) {
      SocketService.emit('chatroom:leave', _currentChatRoomId);
    }

    // 加入新房间
    _currentChatRoomId = chatRoomId;
    notifyListeners();

    SocketService.emit('chatroom:join', chatRoomId);
    SocketService.emit('agent:status', chatRoomId);

    // 加载消息
    chatStore.loadMessages(chatRoomId);
  }

  /// 离开聊天室
  void leaveChatRoom(String chatRoomId, ChatStore chatStore) {
    if (_currentChatRoomId == chatRoomId) {
      SocketService.emit('chatroom:leave', chatRoomId);
      _currentChatRoomId = null;
      notifyListeners();
      chatStore.clearMessages();
    }
  }

  /// 发送消息
  void sendMessage(SocketMessage message) {
    SocketService.emit('message', message.toJson());
  }

  /// 标记聊天室已读
  void markChatRoomRead(String chatRoomId) {
    SocketService.emit('chatroom:mark-read', chatRoomId);
  }

  /// 停止 Agent
  void stopAgent(String chatRoomId, String agentId) {
    SocketService.emit('agent:stop', {'chatRoomId': chatRoomId, 'agentId': agentId});
  }
}