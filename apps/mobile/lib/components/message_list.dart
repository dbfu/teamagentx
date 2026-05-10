import 'package:flutter/material.dart';
import '../models/models.dart';
import '../stores/chat_store.dart';
import 'message_bubble.dart';
import 'agent_typing_indicator.dart';

/// 消息列表组件
class MessageList extends StatefulWidget {
  final List<Message> messages;
  final List<TypingAgent> typingAgents;
  final String streamingContent;
  final String streamingThinking;

  const MessageList({
    super.key,
    required this.messages,
    this.typingAgents = const [],
    this.streamingContent = '',
    this.streamingThinking = '',
  });

  @override
  State<MessageList> createState() => _MessageListState();
}

class _MessageListState extends State<MessageList> {
  final ScrollController _scrollController = ScrollController();

  @override
  void didUpdateWidget(MessageList oldWidget) {
    super.didUpdateWidget(oldWidget);
    // 新消息时自动滚动到底部
    if (widget.messages.length != oldWidget.messages.length) {
      Future.delayed(Duration(milliseconds: 100), () {
        if (_scrollController.hasClients) {
          _scrollController.animateTo(
            _scrollController.position.maxScrollExtent,
            duration: Duration(milliseconds: 200),
            curve: Curves.easeOut,
          );
        }
      });
    }
  }

  @override
  void dispose() {
    _scrollController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return ListView.builder(
      controller: _scrollController,
      padding: const EdgeInsets.all(16),
      itemCount: widget.messages.length + (widget.typingAgents.isNotEmpty ? 1 : 0),
      itemBuilder: (context, index) {
        if (index < widget.messages.length) {
          return MessageBubble(message: widget.messages[index]);
        }

        // 打字指示器
        return AgentTypingIndicator(
          agents: widget.typingAgents,
          streamingContent: widget.streamingContent,
          streamingThinking: widget.streamingThinking,
        );
      },
    );
  }
}