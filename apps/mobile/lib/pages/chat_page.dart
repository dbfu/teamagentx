import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:uuid/uuid.dart';
import '../models/models.dart';
import '../stores/auth_store.dart';
import '../stores/chat_store.dart';
import '../stores/socket_store.dart';
import '../stores/chat_room_store.dart';
import '../constants/colors.dart';
import '../components/avatar.dart';
import '../components/message_list.dart';
import '../components/chat_input.dart';

/// 聊天详情页面
class ChatPage extends StatefulWidget {
  final String chatRoomId;

  const ChatPage({super.key, required this.chatRoomId});

  @override
  State<ChatPage> createState() => _ChatPageState();
}

class _ChatPageState extends State<ChatPage> {
  ChatRoom? _room;

  @override
  void initState() {
    super.initState();
    _init();
  }

  void _init() {
    final chatRoomStore = context.read<ChatRoomStore>();
    final socketStore = context.read<SocketStore>();
    final chatStore = context.read<ChatStore>();

    // 找到聊天室
    _room = chatRoomStore.getRoomById(widget.chatRoomId);
    setState(() {});

    // 加入聊天室
    if (socketStore.isConnected) {
      socketStore.joinChatRoom(widget.chatRoomId, chatStore);
      socketStore.markChatRoomRead(widget.chatRoomId);
    }
  }

  @override
  void dispose() {
    final socketStore = context.read<SocketStore>();
    final chatStore = context.read<ChatStore>();
    socketStore.leaveChatRoom(widget.chatRoomId, chatStore);
    super.dispose();
  }

  void _handleSend(Map<String, dynamic> data) {
    final socketStore = context.read<SocketStore>();
    final uuid = Uuid();
    final messageId = uuid.v4();

    final message = SocketMessage(
      id: messageId,
      type: 'message',
      content: data['content'] as String,
      time: DateTime.now().toIso8601String(),
      chatRoomId: widget.chatRoomId,
      isHuman: true,
      attachments: data['attachments'] as List<Map<String, dynamic>>?,
    );

    // 发送消息到服务器
    socketStore.sendMessage(message);

    // 添加用户消息到本地
    final chatStore = context.read<ChatStore>();
    final authStore = context.read<AuthStore>();

    chatStore.addMessage(Message(
      id: messageId,
      type: 'MESSAGE',
      content: data['content'] as String,
      time: DateTime.now().toIso8601String(),
      userId: authStore.user?.id,
      agentId: null,
      chatRoomId: widget.chatRoomId,
      replyMessageId: null,
      isHuman: true,
      createdAt: DateTime.now().toIso8601String(),
      updatedAt: DateTime.now().toIso8601String(),
      user: authStore.user,
      agent: null,
      attachments: (data['attachments'] as List?)
          ?.map((a) => Attachment(
                url: a['url'] as String,
                filename: a['filename'] as String,
                mimeType: a['mimeType'] as String,
                size: a['size'] as int,
                width: a['width'] as int?,
                height: a['height'] as int?,
              ))
          .toList(),
    ));
  }

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;

    return Consumer3<ChatStore, SocketStore, ChatRoomStore>(
      builder: (context, chatStore, socketStore, chatRoomStore, _) {
        // 获取当前消息列表的打字 Agent
        final typingAgents = chatStore.getTypingAgentsForMessage(
          chatStore.messages.isNotEmpty ? chatStore.messages.first.id : '',
        );

        final currentStreamKey =
            '${chatStore.messages.isNotEmpty ? chatStore.messages.first.id : ''}_${typingAgents.isNotEmpty ? typingAgents.first.agentId : ''}';
        final streamingContent = chatStore.getStreamContent(currentStreamKey);
        final streamingThinking = chatStore.getStreamThinking(currentStreamKey);

        // 计算助手和成员数量
        final agentCount =
            _room?.chatRoomAgents.where((a) => a.agentId != null).length ?? 0;
        final memberCount =
            _room?.chatRoomAgents.where((a) => a.userId != null).length ?? 0;

        return Scaffold(
          backgroundColor: AppColors.getBackground(isDark),
          appBar: AppBar(
            backgroundColor: AppColors.getCard(isDark),
            elevation: 0,
            leading: GestureDetector(
              onTap: () => Navigator.of(context).pop(),
              child: Center(
                child: Text(
                  '‹',
                  style: TextStyle(
                    fontSize: 28,
                    color: AppColors.primary,
                  ),
                ),
              ),
            ),
            titleSpacing: 0,
            title: Row(
              children: [
                if (_room != null)
                  Avatar(
                    name: _room!.name,
                    avatar: _room!.avatar,
                    avatarColor: _room!.avatarColor,
                    size: 32,
                  ),
                const SizedBox(width: 8),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        _room?.name ?? '聊天',
                        style: TextStyle(
                          fontSize: 18,
                          fontWeight: FontWeight.w600,
                          color: AppColors.getText(isDark),
                        ),
                        overflow: TextOverflow.ellipsis,
                      ),
                      Text(
                        '$agentCount 位助手 · $memberCount 位成员',
                        style: TextStyle(
                          fontSize: 12,
                          color: AppColors.getTextSecondary(isDark),
                        ),
                      ),
                    ],
                  ),
                ),
              ],
            ),
            actions: [
              Padding(
                padding: const EdgeInsets.only(right: 8),
                child: GestureDetector(
                  onTap: () {
                    // TODO: 打开成员管理
                  },
                  child: Container(
                    width: 36,
                    height: 36,
                    decoration: BoxDecoration(
                      color: isDark ? const Color(0xFF2C2C2E) : Colors.grey.shade100,
                      borderRadius: BorderRadius.circular(8),
                    ),
                    child: const Center(
                      child: Text('👥', style: TextStyle(fontSize: 18)),
                    ),
                  ),
                ),
              ),
            ],
          ),
          body: Column(
            children: [
              // 消息列表
              Expanded(
                child: MessageList(
                  messages: chatStore.messages,
                  typingAgents: typingAgents,
                  streamingContent: streamingContent,
                  streamingThinking: streamingThinking,
                ),
              ),

              // 输入区域
              ChatInput(
                chatRoomId: widget.chatRoomId,
                onSend: _handleSend,
                disabled: !socketStore.isConnected,
                placeholder: socketStore.isConnected ? '输入消息...' : '连接中...',
              ),
            ],
          ),
        );
      },
    );
  }
}