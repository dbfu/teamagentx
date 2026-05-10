import 'package:flutter/foundation.dart';
import '../models/models.dart';
import '../services/api_client.dart';

/// Agent 打字信息
class TypingAgent {
  final String agentId;
  final String agentName;

  TypingAgent({required this.agentId, required this.agentName});
}

/// 聊天状态管理
class ChatStore extends ChangeNotifier {
  List<Message> _messages = [];
  bool _loading = false;

  /// Agent 执行状态
  Map<String, List<TypingAgent>> _typingAgents = {};
  Map<String, AgentStatus> _agentStatuses = {};

  /// 流式输出状态
  Map<String, String> _streamingContent = {};
  Map<String, String> _streamingThinking = {};
  Set<String> _completedAgents = {};

  /// 未读数
  Map<String, int> _unreadCounts = {};

  List<Message> get messages => _messages;
  bool get loading => _loading;
  Map<String, List<TypingAgent>> get typingAgents => _typingAgents;
  Map<String, String> get streamingContent => _streamingContent;
  Map<String, String> get streamingThinking => _streamingThinking;
  Map<String, int> get unreadCounts => _unreadCounts;

  /// 加载消息
  Future<void> loadMessages(String chatRoomId) async {
    _loading = true;
    notifyListeners();

    try {
      final response = await MessageApi.getAll(chatRoomId);
      if (response.success && response.data != null) {
        _messages = response.data!;
      }
      _loading = false;
      notifyListeners();
    } catch (e) {
      _loading = false;
      notifyListeners();
    }
  }

  /// 添加消息
  void addMessage(Message message) {
    // 避免重复消息
    if (_messages.any((m) => m.id == message.id)) {
      return;
    }
    _messages = [..._messages, message];
    notifyListeners();
  }

  /// 设置消息列表
  void setMessages(List<Message> messages) {
    _messages = messages;
    notifyListeners();
  }

  /// 清空消息
  void clearMessages() {
    _messages = [];
    notifyListeners();
  }

  /// 设置打字的 Agents
  void setTypingAgents(String messageId, List<TypingAgent> agents) {
    _typingAgents[messageId] = agents;
    notifyListeners();
  }

  /// 添加打字的 Agent
  void addTypingAgent(String messageId, TypingAgent agent) {
    final existing = _typingAgents[messageId] ?? [];
    if (!existing.any((a) => a.agentId == agent.agentId)) {
      _typingAgents[messageId] = [...existing, agent];
      notifyListeners();
    }
  }

  /// 移除打字的 Agent
  void removeTypingAgent(String messageId, String agentId) {
    final existing = _typingAgents[messageId] ?? [];
    final filtered = existing.where((a) => a.agentId != agentId).toList();
    if (filtered.isEmpty) {
      _typingAgents.remove(messageId);
    } else {
      _typingAgents[messageId] = filtered;
    }
    notifyListeners();
  }

  /// 设置 Agent 状态
  void setAgentStatus(String agentId, AgentStatus status) {
    _agentStatuses[agentId] = status;
    notifyListeners();
  }

  /// 添加流式内容
  void appendStreamContent(String key, String content) {
    final existing = _streamingContent[key] ?? '';
    _streamingContent[key] = existing + content;
    notifyListeners();
  }

  /// 添加流式思考内容
  void appendStreamThinking(String key, String thinking) {
    final existing = _streamingThinking[key] ?? '';
    _streamingThinking[key] = existing + thinking;
    notifyListeners();
  }

  /// 标记 Agent 完成
  void markAgentComplete(String key) {
    _completedAgents.add(key);
    notifyListeners();
  }

  /// 清除流式状态
  void clearStreamState(String key) {
    _streamingContent.remove(key);
    _streamingThinking.remove(key);
    _completedAgents.remove(key);
    notifyListeners();
  }

  /// 设置未读数
  void setUnreadCounts(Map<String, int> counts) {
    _unreadCounts = counts;
    notifyListeners();
  }

  /// 更新单个聊天室未读数
  void updateUnreadCount(String chatRoomId, int count) {
    _unreadCounts[chatRoomId] = count;
    notifyListeners();
  }

  /// 获取指定消息的打字 Agents
  List<TypingAgent> getTypingAgentsForMessage(String messageId) {
    return _typingAgents[messageId] ?? [];
  }

  /// 获取流式内容
  String getStreamContent(String key) {
    return _streamingContent[key] ?? '';
  }

  /// 获取流式思考内容
  String getStreamThinking(String key) {
    return _streamingThinking[key] ?? '';
  }
}