import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../models/models.dart';
import '../stores/auth_store.dart';
import '../services/api_client.dart';
import '../constants/colors.dart';
import '../components/avatar.dart';

/// 助手详情页面
class AgentPage extends StatefulWidget {
  final String agentId;

  const AgentPage({super.key, required this.agentId});

  @override
  State<AgentPage> createState() => _AgentPageState();
}

class _AgentPageState extends State<AgentPage> {
  Agent? _agent;
  bool _loading = true;
  bool _startingChat = false;

  @override
  void initState() {
    super.initState();
    _loadAgent();
  }

  Future<void> _loadAgent() async {
    final response = await AgentApi.getById(widget.agentId);
    if (response.success && response.data != null) {
      _agent = response.data;
    }
    setState(() {
      _loading = false;
    });
  }

  Future<void> _handleQuickChat() async {
    if (_agent == null) return;

    final authStore = context.read<AuthStore>();
    if (authStore.user == null) return;

    setState(() {
      _startingChat = true;
    });

    final response = await AgentApi.createQuickChat(
      _agent!.id,
      authStore.user!.id,
      null,
    );

    if (response.success && response.data != null) {
      Navigator.of(context).pushReplacementNamed('/chat/${response.data!.id}');
    }

    setState(() {
      _startingChat = false;
    });
  }

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;

    if (_loading) {
      return Scaffold(
        backgroundColor: AppColors.getBackground(isDark),
        body: Center(
          child: CircularProgressIndicator(color: AppColors.primary),
        ),
      );
    }

    if (_agent == null) {
      return Scaffold(
        backgroundColor: AppColors.getBackground(isDark),
        body: Center(
          child: Text(
            '助手不存在',
            style: TextStyle(color: AppColors.getTextSecondary(isDark)),
          ),
        ),
      );
    }

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
        title: Text(
          '助手详情',
          style: TextStyle(
            fontSize: 18,
            fontWeight: FontWeight.w600,
            color: AppColors.getText(isDark),
          ),
        ),
        centerTitle: true,
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(16),
        child: Column(
          children: [
            // Agent 卡片
            Container(
              padding: const EdgeInsets.all(20),
              decoration: BoxDecoration(
                color: AppColors.getCard(isDark),
                borderRadius: BorderRadius.circular(16),
              ),
              child: Column(
                children: [
                  Avatar(
                    name: _agent!.name,
                    avatar: _agent!.avatar,
                    avatarColor: _agent!.avatarColor,
                    size: 56,
                  ),
                  const SizedBox(height: 16),
                  Text(
                    _agent!.name,
                    style: TextStyle(
                      fontSize: 24,
                      fontWeight: FontWeight.bold,
                      color: AppColors.getText(isDark),
                    ),
                  ),
                  if (_agent!.description != null)
                    Padding(
                      padding: const EdgeInsets.only(top: 8),
                      child: Text(
                        _agent!.description!,
                        textAlign: TextAlign.center,
                        style: TextStyle(
                          fontSize: 14,
                          color: AppColors.getTextSecondary(isDark),
                        ),
                      ),
                    ),

                  // 状态
                  const SizedBox(height: 16),
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 8),
                    child: Column(
                      children: [
                        Text(
                          _agent!.isActive ? '启用' : '禁用',
                          style: TextStyle(
                            fontSize: 18,
                            fontWeight: FontWeight.w600,
                            color: _agent!.isActive
                                ? AppColors.success
                                : AppColors.getTextSecondary(isDark),
                          ),
                        ),
                        const SizedBox(height: 4),
                        Text(
                          '状态',
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
            ),

            const SizedBox(height: 24),

            // 快速对话按钮
            GestureDetector(
              onTap: _startingChat ? null : _handleQuickChat,
              child: Container(
                width: double.infinity,
                height: 56,
                decoration: BoxDecoration(
                  color: AppColors.primary.withOpacity(_startingChat ? 0.6 : 1),
                  borderRadius: BorderRadius.circular(12),
                ),
                child: Center(
                  child: Text(
                    _startingChat ? '创建中...' : '开始对话',
                    style: const TextStyle(
                      fontSize: 16,
                      fontWeight: FontWeight.w600,
                      color: Colors.white,
                    ),
                  ),
                ),
              ),
            ),

            const SizedBox(height: 24),

            // 配置信息
            Text(
              '配置信息',
              style: TextStyle(
                fontSize: 12,
                fontWeight: FontWeight.w600,
                color: AppColors.getTextSecondary(isDark),
              ),
            ),
            const SizedBox(height: 8),
            Container(
              decoration: BoxDecoration(
                color: AppColors.getCard(isDark),
                borderRadius: BorderRadius.circular(12),
              ),
              child: Column(
                children: [
                  _buildDetailRow('类型', _agent!.type == 'builtin' ? '内置' : 'ACP', isDark, false),
                  _buildDetailRow('模型', _agent!.llmProvider?.model ?? '-', isDark, false),
                  _buildDetailRow('供应商', _agent!.llmProvider?.name ?? '-', isDark, false),
                  _buildDetailRow(
                    '创建时间',
                    DateTime.tryParse(_agent!.createdAt)?.toString() ?? '-',
                    isDark,
                    true,
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildDetailRow(String label, String value, bool isDark, bool isLast) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
      decoration: BoxDecoration(
        border: isLast
            ? null
            : Border(
                bottom: BorderSide(color: AppColors.getBorder(isDark)),
              ),
      ),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Text(
            label,
            style: TextStyle(
              fontSize: 16,
              color: AppColors.getTextSecondary(isDark),
            ),
          ),
          Text(
            value,
            style: TextStyle(
              fontSize: 16,
              fontWeight: FontWeight.w500,
              color: AppColors.getText(isDark),
            ),
          ),
        ],
      ),
    );
  }
}