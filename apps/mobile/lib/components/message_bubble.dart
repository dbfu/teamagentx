import 'package:flutter/material.dart';
import 'package:cached_network_image/cached_network_image.dart';
import 'package:intl/intl.dart';
import '../models/models.dart';
import '../constants/colors.dart';
import 'avatar.dart';

/// 消息气泡组件
class MessageBubble extends StatelessWidget {
  final Message message;

  const MessageBubble({super.key, required this.message});

  bool get _isUser => message.isHuman;

  String get _senderName {
    if (_isUser) {
      return message.user?.username ?? '用户';
    }
    return message.agent?.name ?? '助手';
  }

  String get _time {
    try {
      final dt = DateTime.parse(message.time);
      return DateFormat.Hm().format(dt);
    } catch (e) {
      return '';
    }
  }

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;

    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: Row(
        mainAxisAlignment:
            _isUser ? MainAxisAlignment.end : MainAxisAlignment.start,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Agent 头像（左侧）
          if (!_isUser && message.agent != null)
            Avatar(
              name: message.agent!.name,
              avatar: message.agent!.avatar,
              avatarColor: message.agent!.avatarColor,
              size: 32,
            ),

          // 消息内容
          Flexible(
            child: Container(
              margin: EdgeInsets.only(left: _isUser ? 0 : 8, right: _isUser ? 0 : 0),
              constraints: BoxConstraints(maxWidth: MediaQuery.of(context).size.width * 0.75),
              child: Column(
                crossAxisAlignment:
                    _isUser ? CrossAxisAlignment.end : CrossAxisAlignment.start,
                children: [
                  // 发送者名称
                  if (!_isUser)
                    Padding(
                      padding: const EdgeInsets.only(bottom: 4),
                      child: Text(
                        _senderName,
                        style: TextStyle(
                          fontSize: 12,
                          color: AppColors.getTextSecondary(isDark),
                        ),
                      ),
                    ),

                  // 消息气泡
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                    decoration: BoxDecoration(
                      color: _isUser
                          ? AppColors.primary
                          : AppColors.getCard(isDark),
                      borderRadius: BorderRadius.circular(16),
                    ),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        // 图片附件
                        if (message.attachments != null)
                          ...message.attachments!.map((attachment) => Padding(
                                padding: const EdgeInsets.only(bottom: 8),
                                child: ClipRRect(
                                  borderRadius: BorderRadius.circular(8),
                                  child: CachedNetworkImage(
                                    imageUrl: attachment.url,
                                    width: 180,
                                    height: 180,
                                    fit: BoxFit.cover,
                                    placeholder: (context, url) => Container(
                                      width: 180,
                                      height: 180,
                                      color: AppColors.getBorder(isDark),
                                      child: const Center(
                                        child: CircularProgressIndicator(strokeWidth: 2),
                                      ),
                                    ),
                                    errorWidget: (context, url, error) => Container(
                                      width: 180,
                                      height: 180,
                                      color: AppColors.getBorder(isDark),
                                      child: const Icon(Icons.image_not_supported),
                                    ),
                                  ),
                                ),
                              )),

                        // 文本内容
                        Text(
                          message.content,
                          style: TextStyle(
                            fontSize: 16,
                            color: _isUser
                                ? Colors.white
                                : AppColors.getText(isDark),
                          ),
                        ),
                      ],
                    ),
                  ),

                  // 时间
                  Padding(
                    padding: const EdgeInsets.only(top: 4),
                    child: Text(
                      _time,
                      style: TextStyle(
                        fontSize: 12,
                        color: AppColors.getTextSecondary(isDark),
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ),

          // 用户头像（右侧）
          if (_isUser && message.user != null)
            Padding(
              padding: const EdgeInsets.only(left: 8),
              child: Avatar(
                name: message.user!.username,
                avatar: message.user!.avatar,
                size: 32,
              ),
            ),
        ],
      ),
    );
  }
}
