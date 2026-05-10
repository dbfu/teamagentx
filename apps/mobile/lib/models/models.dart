/// 用户模型
class User {
  final String id;
  final String username;
  final String? avatar;
  final String? avatarColor;
  final String createdAt;

  User({
    required this.id,
    required this.username,
    this.avatar,
    this.avatarColor,
    required this.createdAt,
  });

  factory User.fromJson(Map<String, dynamic> json) {
    return User(
      id: json['id'] ?? '',
      username: json['username'] ?? '',
      avatar: json['avatar'],
      avatarColor: json['avatarColor'],
      createdAt: json['createdAt'] ?? '',
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'id': id,
      'username': username,
      'avatar': avatar,
      'avatarColor': avatarColor,
      'createdAt': createdAt,
    };
  }
}

/// Agent 分类
class AgentCategory {
  final String id;
  final String name;
  final String? description;
  final int sortOrder;
  final String createdAt;
  final String updatedAt;

  AgentCategory({
    required this.id,
    required this.name,
    this.description,
    required this.sortOrder,
    required this.createdAt,
    required this.updatedAt,
  });

  factory AgentCategory.fromJson(Map<String, dynamic> json) {
    return AgentCategory(
      id: json['id'] ?? '',
      name: json['name'] ?? '',
      description: json['description'],
      sortOrder: json['sortOrder'] ?? 0,
      createdAt: json['createdAt'] ?? '',
      updatedAt: json['updatedAt'] ?? '',
    );
  }
}

/// Agent 模型
class Agent {
  final String id;
  final String name;
  final String? avatar;
  final String? avatarColor;
  final String? description;
  final String prompt;
  final String type;
  final String agentLevel;
  final String? acpTool;
  final String? workDir;
  final bool isActive;
  final String? categoryId;
  final AgentCategory? category;
  final LlmProvider? llmProvider;
  final int sortOrder;
  final String createdAt;
  final String updatedAt;

  Agent({
    required this.id,
    required this.name,
    this.avatar,
    this.avatarColor,
    this.description,
    required this.prompt,
    required this.type,
    required this.agentLevel,
    this.acpTool,
    this.workDir,
    required this.isActive,
    this.categoryId,
    this.category,
    this.llmProvider,
    required this.sortOrder,
    required this.createdAt,
    required this.updatedAt,
  });

  factory Agent.fromJson(Map<String, dynamic> json) {
    return Agent(
      id: json['id'] ?? '',
      name: json['name'] ?? '',
      avatar: json['avatar'],
      avatarColor: json['avatarColor'],
      description: json['description'],
      prompt: json['prompt'] ?? '',
      type: json['type'] ?? 'builtin',
      agentLevel: json['agentLevel'] ?? 'normal',
      acpTool: json['acpTool'],
      workDir: json['workDir'],
      isActive: json['isActive'] ?? false,
      categoryId: json['categoryId'],
      category: json['category'] != null
          ? AgentCategory.fromJson(json['category'])
          : null,
      llmProvider: json['llmProvider'] != null
          ? LlmProvider.fromJson(json['llmProvider'])
          : null,
      sortOrder: json['sortOrder'] ?? 0,
      createdAt: json['createdAt'] ?? '',
      updatedAt: json['updatedAt'] ?? '',
    );
  }
}

/// LLM 供应商
class LlmProvider {
  final String id;
  final String name;
  final String type;
  final String? apiUrl;
  final String model;
  final bool isActive;
  final bool isDefault;

  LlmProvider({
    required this.id,
    required this.name,
    required this.type,
    this.apiUrl,
    required this.model,
    required this.isActive,
    required this.isDefault,
  });

  factory LlmProvider.fromJson(Map<String, dynamic> json) {
    return LlmProvider(
      id: json['id'] ?? '',
      name: json['name'] ?? '',
      type: json['type'] ?? '',
      apiUrl: json['apiUrl'],
      model: json['model'] ?? '',
      isActive: json['isActive'] ?? false,
      isDefault: json['isDefault'] ?? false,
    );
  }
}

/// ChatRoom Agent 关联
class ChatRoomAgent {
  final String id;
  final String? userId;
  final String? agentId;
  final String role;
  final bool injectGroupHistory;
  final String? customWorkDir;
  final String joinedAt;
  final Agent? agent;
  final User? user;

  ChatRoomAgent({
    required this.id,
    this.userId,
    this.agentId,
    required this.role,
    required this.injectGroupHistory,
    this.customWorkDir,
    required this.joinedAt,
    this.agent,
    this.user,
  });

  factory ChatRoomAgent.fromJson(Map<String, dynamic> json) {
    return ChatRoomAgent(
      id: json['id'] ?? '',
      userId: json['userId'],
      agentId: json['agentId'],
      role: json['role'] ?? '',
      injectGroupHistory: json['injectGroupHistory'] ?? false,
      customWorkDir: json['customWorkDir'],
      joinedAt: json['joinedAt'] ?? '',
      agent: json['agent'] != null ? Agent.fromJson(json['agent']) : null,
      user: json['user'] != null ? User.fromJson(json['user']) : null,
    );
  }
}

/// 聊天室模型
class ChatRoom {
  final String id;
  final String name;
  final String? avatar;
  final String? avatarColor;
  final String? description;
  final String? rules;
  final String? ownerId;
  final String createdAt;
  final String updatedAt;
  final bool? isQuickChatRoom;
  final String? quickChatAgentId;
  final String? defaultAgentId;
  final User? owner;
  final List<ChatRoomAgent> chatRoomAgents;

  ChatRoom({
    required this.id,
    required this.name,
    this.avatar,
    this.avatarColor,
    this.description,
    this.rules,
    this.ownerId,
    required this.createdAt,
    required this.updatedAt,
    this.isQuickChatRoom,
    this.quickChatAgentId,
    this.defaultAgentId,
    this.owner,
    required this.chatRoomAgents,
  });

  factory ChatRoom.fromJson(Map<String, dynamic> json) {
    return ChatRoom(
      id: json['id'] ?? '',
      name: json['name'] ?? '',
      avatar: json['avatar'],
      avatarColor: json['avatarColor'],
      description: json['description'],
      rules: json['rules'],
      ownerId: json['ownerId'],
      createdAt: json['createdAt'] ?? '',
      updatedAt: json['updatedAt'] ?? '',
      isQuickChatRoom: json['isQuickChatRoom'],
      quickChatAgentId: json['quickChatAgentId'],
      defaultAgentId: json['defaultAgentId'],
      owner: json['owner'] != null ? User.fromJson(json['owner']) : null,
      chatRoomAgents: (json['chatRoomAgents'] as List?)
              ?.map((e) => ChatRoomAgent.fromJson(e))
              .toList() ??
          [],
    );
  }
}

/// 消息附件
class Attachment {
  final String? id;
  final String? type;
  final String filename;
  final String mimeType;
  final int size;
  final String url;
  final int? width;
  final int? height;
  final String? createdAt;

  Attachment({
    this.id,
    this.type,
    required this.filename,
    required this.mimeType,
    required this.size,
    required this.url,
    this.width,
    this.height,
    this.createdAt,
  });

  factory Attachment.fromJson(Map<String, dynamic> json) {
    return Attachment(
      id: json['id'],
      type: json['type'],
      filename: json['filename'] ?? '',
      mimeType: json['mimeType'] ?? '',
      size: json['size'] ?? 0,
      url: json['url'] ?? '',
      width: json['width'],
      height: json['height'],
      createdAt: json['createdAt'],
    );
  }
}

/// 消息模型
class Message {
  final String id;
  final String type;
  final String content;
  final String time;
  final String? userId;
  final String? agentId;
  final String chatRoomId;
  final String? replyMessageId;
  final bool isHuman;
  final String? executionRecordId;
  final int? executionDuration;
  final int? totalTokens;
  final String? avatar;
  final String? avatarColor;
  final String createdAt;
  final String updatedAt;
  final User? user;
  final Agent? agent;
  final List<Attachment>? attachments;

  Message({
    required this.id,
    required this.type,
    required this.content,
    required this.time,
    this.userId,
    this.agentId,
    required this.chatRoomId,
    this.replyMessageId,
    required this.isHuman,
    this.executionRecordId,
    this.executionDuration,
    this.totalTokens,
    this.avatar,
    this.avatarColor,
    required this.createdAt,
    required this.updatedAt,
    this.user,
    this.agent,
    this.attachments,
  });

  factory Message.fromJson(Map<String, dynamic> json) {
    return Message(
      id: json['id'] ?? '',
      type: json['type'] ?? 'MESSAGE',
      content: json['content'] ?? '',
      time: json['time'] ?? '',
      userId: json['userId'],
      agentId: json['agentId'],
      chatRoomId: json['chatRoomId'] ?? '',
      replyMessageId: json['replyMessageId'],
      isHuman: json['isHuman'] ?? true,
      executionRecordId: json['executionRecordId'],
      executionDuration: json['executionDuration'],
      totalTokens: json['totalTokens'],
      avatar: json['avatar'],
      avatarColor: json['avatarColor'],
      createdAt: json['createdAt'] ?? '',
      updatedAt: json['updatedAt'] ?? '',
      user: json['user'] != null ? User.fromJson(json['user']) : null,
      agent: json['agent'] != null ? Agent.fromJson(json['agent']) : null,
      attachments: (json['attachments'] as List?)
              ?.map((e) => Attachment.fromJson(e))
              .toList() ??
          [],
    );
  }
}

/// API 响应
class ApiResponse<T> {
  final bool success;
  final T? data;
  final String? error;

  ApiResponse({
    required this.success,
    this.data,
    this.error,
  });

  factory ApiResponse.fromJson(
      Map<String, dynamic> json, T Function(Map<String, dynamic>) fromJsonT) {
    return ApiResponse(
      success: json['success'] ?? false,
      data: json['data'] != null ? fromJsonT(json['data']) : null,
      error: json['error'],
    );
  }
}

/// 上传结果
class UploadResult {
  final String filename;
  final String mimeType;
  final int size;
  final String url;
  final int width;
  final int height;

  UploadResult({
    required this.filename,
    required this.mimeType,
    required this.size,
    required this.url,
    required this.width,
    required this.height,
  });

  factory UploadResult.fromJson(Map<String, dynamic> json) {
    return UploadResult(
      filename: json['filename'] ?? '',
      mimeType: json['mimeType'] ?? '',
      size: json['size'] ?? 0,
      url: json['url'] ?? '',
      width: json['width'] ?? 0,
      height: json['height'] ?? 0,
    );
  }
}

/// Agent 执行状态
enum AgentStatus { idle, executing, busy }

/// Agent 打字数据
class AgentTypingData {
  final String messageId;
  final String agentId;
  final String agentName;

  AgentTypingData({
    required this.messageId,
    required this.agentId,
    required this.agentName,
  });

  factory AgentTypingData.fromJson(Map<String, dynamic> json) {
    return AgentTypingData(
      messageId: json['messageId'] ?? '',
      agentId: json['agentId'] ?? '',
      agentName: json['agentName'] ?? '',
    );
  }
}

/// Socket 消息
class SocketMessage {
  final String id;
  final String type;
  final String content;
  final String time;
  final String? userId;
  final String? agentId;
  final String? agentName;
  final String? avatar;
  final String? avatarColor;
  final String chatRoomId;
  final String? replyMessageId;
  final bool? isHuman;
  final List<Map<String, dynamic>>? attachments;

  SocketMessage({
    required this.id,
    required this.type,
    required this.content,
    required this.time,
    this.userId,
    this.agentId,
    this.agentName,
    this.avatar,
    this.avatarColor,
    required this.chatRoomId,
    this.replyMessageId,
    this.isHuman,
    this.attachments,
  });

  Map<String, dynamic> toJson() {
    return {
      'id': id,
      'type': type,
      'content': content,
      'time': time,
      'userId': userId,
      'agentId': agentId,
      'agentName': agentName,
      'avatar': avatar,
      'avatarColor': avatarColor,
      'chatRoomId': chatRoomId,
      'replyMessageId': replyMessageId,
      'isHuman': isHuman ?? true,
      'attachments': attachments,
    };
  }
}