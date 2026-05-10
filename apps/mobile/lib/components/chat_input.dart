import 'dart:io';
import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';
import '../services/api_client.dart';
import '../constants/colors.dart';

/// 聊天输入组件
class ChatInput extends StatefulWidget {
  final String chatRoomId;
  final void Function(Map<String, dynamic> data) onSend;
  final bool disabled;
  final String placeholder;

  const ChatInput({
    super.key,
    required this.chatRoomId,
    required this.onSend,
    this.disabled = false,
    this.placeholder = '输入消息...',
  });

  @override
  State<ChatInput> createState() => _ChatInputState();
}

class _ChatInputState extends State<ChatInput> {
  final TextEditingController _textController = TextEditingController();
  final ImagePicker _imagePicker = ImagePicker();
  List<XFile> _pendingImages = [];
  bool _uploading = false;

  Future<void> _pickImage() async {
    try {
      final images = await _imagePicker.pickMultiImage(
        imageQuality: 80,
        maxWidth: 1920,
        maxHeight: 1920,
      );

      if (images.isNotEmpty) {
        setState(() {
          _pendingImages = [..._pendingImages, ...images].take(5).toList();
        });
      }
    } catch (e) {
      print('选择图片失败: $e');
    }
  }

  void _removeImage(int index) {
    setState(() {
      _pendingImages.removeAt(index);
    });
  }

  Future<void> _send() async {
    final text = _textController.text.trim();
    if (text.isEmpty && _pendingImages.isEmpty) return;
    if (widget.disabled || _uploading) return;

    setState(() {
      _uploading = true;
    });

    try {
      // 上传图片
      final attachments = <Map<String, dynamic>>[];

      for (final image in _pendingImages) {
        final filename = image.name;
        final response = await ApiClient.uploadImage(
          image.path,
          'image/jpeg',
          filename,
        );

        if (response.success && response.data != null) {
          attachments.add({
            'url': response.data!.url,
            'filename': response.data!.filename,
            'mimeType': response.data!.mimeType,
            'size': response.data!.size,
            'width': response.data!.width,
            'height': response.data!.height,
          });
        }
      }

      // 发送消息
      widget.onSend({
        'content': text,
        'attachments': attachments.isNotEmpty ? attachments : null,
      });

      // 清空输入
      _textController.clear();
      setState(() {
        _pendingImages = [];
        _uploading = false;
      });
    } catch (e) {
      print('发送消息失败: $e');
      setState(() {
        _uploading = false;
      });
    }
  }

  bool get _canSend {
    return (_textController.text.trim().isNotEmpty || _pendingImages.isNotEmpty) &&
        !widget.disabled &&
        !_uploading;
  }

  @override
  void dispose() {
    _textController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;

    return Column(
      children: [
        // 待发送图片预览
        if (_pendingImages.isNotEmpty)
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
            color: AppColors.getCard(isDark),
            child: Row(
              children: _pendingImages.asMap().entries.map((entry) {
                final index = entry.key;
                final image = entry.value;
                return Container(
                  margin: const EdgeInsets.only(right: 8),
                  child: Stack(
                    children: [
                      ClipRRect(
                        borderRadius: BorderRadius.circular(8),
                        child: Image.file(
                          File(image.path),
                          width: 64,
                          height: 64,
                          fit: BoxFit.cover,
                        ),
                      ),
                      Positioned(
                        top: -4,
                        right: -4,
                        child: GestureDetector(
                          onTap: () => _removeImage(index),
                          child: Container(
                            width: 20,
                            height: 20,
                            decoration: BoxDecoration(
                              shape: BoxShape.circle,
                              color: AppColors.error,
                            ),
                            child: const Icon(
                              Icons.close,
                              size: 12,
                              color: Colors.white,
                            ),
                          ),
                        ),
                      ),
                    ],
                  ),
                );
              }).toList(),
            ),
          ),

        // 输入区域
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
          decoration: BoxDecoration(
            color: AppColors.getCard(isDark),
            border: Border(
              top: BorderSide(color: AppColors.getBorder(isDark)),
            ),
          ),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.end,
            children: [
              // 图片按钮
              GestureDetector(
                onTap: widget.disabled || _uploading ? null : _pickImage,
                child: Container(
                  width: 36,
                  height: 36,
                  decoration: BoxDecoration(
                    shape: BoxShape.circle,
                    color: AppColors.getCard(isDark),
                  ),
                  child: const Center(
                    child: Text('📷', style: TextStyle(fontSize: 18)),
                  ),
                ),
              ),

              const SizedBox(width: 8),

              // 文本输入
              Expanded(
                child: Container(
                  padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                  decoration: BoxDecoration(
                    color: isDark
                        ? const Color(0xFF2C2C2E)
                        : AppColors.lightBackground,
                    borderRadius: BorderRadius.circular(16),
                  ),
                  child: TextField(
                    controller: _textController,
                    enabled: !widget.disabled && !_uploading,
                    maxLines: 4,
                    maxLength: 2000,
                    decoration: InputDecoration(
                      border: InputBorder.none,
                      hintText: widget.placeholder,
                      hintStyle: TextStyle(
                        color: AppColors.getTextSecondary(isDark),
                      ),
                      counterText: '',
                    ),
                    style: TextStyle(
                      color: AppColors.getText(isDark),
                      fontSize: 16,
                    ),
                    onChanged: (_) => setState(() {}),
                  ),
                ),
              ),

              const SizedBox(width: 8),

              // 发送按钮
              GestureDetector(
                onTap: _canSend ? _send : null,
                child: Container(
                  width: 36,
                  height: 36,
                  decoration: BoxDecoration(
                    shape: BoxShape.circle,
                    color: _canSend
                        ? AppColors.primary
                        : AppColors.getBorder(isDark),
                  ),
                  child: Center(
                    child: Text(
                      '➤',
                      style: TextStyle(
                        fontSize: 18,
                        color: _canSend ? Colors.white : Colors.grey,
                      ),
                    ),
                  ),
                ),
              ),
            ],
          ),
        ),
      ],
    );
  }
}