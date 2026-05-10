import 'package:flutter/material.dart';
import '../stores/chat_store.dart';
import '../constants/colors.dart';
import 'avatar.dart';

/// Agent 打字指示器组件
class AgentTypingIndicator extends StatefulWidget {
  final List<TypingAgent> agents;
  final String streamingContent;
  final String streamingThinking;

  const AgentTypingIndicator({
    super.key,
    required this.agents,
    this.streamingContent = '',
    this.streamingThinking = '',
  });

  @override
  State<AgentTypingIndicator> createState() => _AgentTypingIndicatorState();
}

class _AgentTypingIndicatorState extends State<AgentTypingIndicator>
    with SingleTickerProviderStateMixin {
  late AnimationController _animationController;
  late Animation<double> _animation;

  @override
  void initState() {
    super.initState();
    _animationController = AnimationController(
      duration: Duration(milliseconds: 500),
      vsync: this,
    );
    _animation = Tween<double>(begin: 0, end: 1).animate(
      CurvedAnimation(parent: _animationController, curve: Curves.easeInOut),
    );
    _animationController.repeat(reverse: true);
  }

  @override
  void dispose() {
    _animationController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    if (widget.agents.isEmpty) return const SizedBox.shrink();

    final isDark = Theme.of(context).brightness == Brightness.dark;
    final agentNames = widget.agents.map((a) => a.agentName).join(', ');

    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Agent 头像
          Avatar(
            name: widget.agents.first.agentName,
            size: 32,
          ),

          // 打字指示器
          Expanded(
            child: Container(
              margin: const EdgeInsets.only(left: 8),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    '$agentNames 正在思考',
                    style: TextStyle(
                      fontSize: 12,
                      color: AppColors.getTextSecondary(isDark),
                    ),
                  ),

                  const SizedBox(height: 4),

                  // 打字动画
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                    decoration: BoxDecoration(
                      color: AppColors.getCard(isDark),
                      borderRadius: BorderRadius.circular(16),
                    ),
                    child: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: List.generate(3, (index) {
                        return AnimatedBuilder(
                          animation: _animation,
                          builder: (context, child) {
                            final opacity = index == 0
                                ? _animation.value
                                : index == 1
                                    ? 0.5 + (_animation.value * 0.5)
                                    : 1 - (_animation.value * 0.5);
                            return Container(
                              margin: const EdgeInsets.only(right: 4),
                              width: 8,
                              height: 8,
                              decoration: BoxDecoration(
                                shape: BoxShape.circle,
                                color: AppColors.getTextSecondary(isDark)
                                    .withOpacity(opacity),
                              ),
                            );
                          },
                        );
                      }),
                    ),
                  ),

                  // 流式思考内容
                  if (widget.streamingThinking.isNotEmpty)
                    Container(
                      margin: const EdgeInsets.only(top: 8),
                      padding: const EdgeInsets.all(8),
                      decoration: BoxDecoration(
                        color: isDark
                            ? Colors.yellow.shade900.withOpacity(0.2)
                            : Colors.yellow.shade50,
                        borderRadius: BorderRadius.circular(12),
                        border: Border.all(
                          color: isDark
                              ? Colors.yellow.shade700
                              : Colors.yellow.shade200,
                        ),
                      ),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            '思考过程',
                            style: TextStyle(
                              fontSize: 12,
                              fontWeight: FontWeight.w500,
                              color: isDark
                                  ? Colors.yellow.shade400
                                  : Colors.yellow.shade600,
                            ),
                          ),
                          const SizedBox(height: 4),
                          Text(
                            widget.streamingThinking,
                            maxLines: 3,
                            overflow: TextOverflow.ellipsis,
                            style: TextStyle(
                              fontSize: 14,
                              color: AppColors.getText(isDark),
                            ),
                          ),
                        ],
                      ),
                    ),

                  // 流式输出内容
                  if (widget.streamingContent.isNotEmpty)
                    Container(
                      margin: const EdgeInsets.only(top: 8),
                      padding: const EdgeInsets.all(8),
                      decoration: BoxDecoration(
                        color: AppColors.getCard(isDark),
                        borderRadius: BorderRadius.circular(12),
                      ),
                      child: Text(
                        widget.streamingContent,
                        maxLines: 5,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(
                          fontSize: 14,
                          color: AppColors.getText(isDark),
                        ),
                      ),
                    ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}