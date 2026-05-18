import { Server, Socket } from 'socket.io';
import jwt from 'jsonwebtoken';
import {
  messageEventEmitter,
  setupAIHandlers,
  getAgentStatuses,
  stopAgentExecution,
  getCachedStreamEvents,
  processQueue,
  broadcastAgentStatus,
  type AgentStatus,
} from '../core/agent/agent-handler/index.js';
import type { ToolCall } from '../core/agent/executor.interface.js';
import { config } from '../config/index.js';
import { authService } from '../modules/auth/auth.service.js';
import { chatRoomService } from '../modules/chatroom/chatroom.service.js';
import { messageService } from '../modules/message/message.service.js';
import { userService } from '../modules/user/user.service.js';
import { taskQueueService } from '../modules/task-queue/task-queue.service.js';
import { todoService } from '../modules/todo/todo.service.js';
import { bridgeService, setBridgeInboundMessageBroadcaster } from '../modules/bridge/bridge.service.js';
import { startTypingLoop, stopTypingLoop } from '../modules/bridge/typing-loop.js';
import { Message, Attachment } from '../types/message.js';

// Track which chatRooms each socket has joined
const socketChatRooms = new Map<string, Set<string>>();

// Extend Socket to include user data
interface AuthenticatedSocket extends Socket {
  data: {
    user?: {
      id: string;
      username: string;
      avatar: string | null;
      avatarColor: string | null;
    };
  };
}

export function setupSocket(io: Server) {
  const emitMessageToChatRoomMembers = async (msg: Message, chatRoomId: string) => {
    // 发给群聊房间（当前在群聊内的 socket）
    io.to(chatRoomId).emit('message', msg);

    // 发给所有群聊成员的用户房间（支持多端同步）
    try {
      const agentsInRoom = await chatRoomService.getAgents(chatRoomId);
      for (const agent of agentsInRoom) {
        if (!agent.userId) continue;

        // 发消息给用户房间（所有该用户的 socket 都会收到）
        io.to(`user:${agent.userId}`).emit('message', msg);

        // 检查该用户是否有任何 socket 在群聊房间内
        // 获取 user:{userId} 房间内的所有 socket
        const userRoomSockets = await io.in(`user:${agent.userId}`).allSockets();
        let hasAnySocketInChatRoom = false;
        for (const socketId of userRoomSockets) {
          const socketInstance = io.sockets.sockets.get(socketId);
          if (socketInstance?.rooms?.has(chatRoomId)) {
            hasAnySocketInChatRoom = true;
            break;
          }
        }

        // 如果没有任何 socket 在群聊内，发送未读更新给该用户所有端
        if (!hasAnySocketInChatRoom) {
          const unreadCount = await chatRoomService.getUnreadCount(chatRoomId, agent.userId);
          io.to(`user:${agent.userId}`).emit('unread:update', { chatRoomId, count: unreadCount });
        }
      }
    } catch (error) {
      console.error('[emitMessageToChatRoomMembers] 发送用户房间消息失败:', error);
    }
  };
  setBridgeInboundMessageBroadcaster(emitMessageToChatRoomMembers);

  // Emit function for AI responses - broadcasts to specific chatRoom room
  // 同时给群聊里所有用户发送未读更新通知
  const emit = async (msg: Message, chatRoomId: string) => {
    await emitMessageToChatRoomMembers(msg, chatRoomId);
    messageEventEmitter.emit('receivedMessage', {message: msg, chatRoomId});
  };

  // Emit typing indicator when agent starts working
  const emitTyping = (data: { messageId: string; agentId: string; agentName: string; status?: 'pending' | 'executing' }, chatRoomId: string) => {
    io.to(chatRoomId).emit('agent:typing', data);
    startTypingLoop(chatRoomId).catch(console.error);
  };

  // Emit done indicator when agent finishes working
  const emitDone = (data: { agentId: string; agentName: string; triggerMessageId: string; executionRecordId?: string; messageIds?: string[]; duration?: number | null; totalTokens?: number | null; cacheReadTokens?: number | null }, chatRoomId: string) => {
    stopTypingLoop(chatRoomId);
    io.to(chatRoomId).emit('agent:done', data);

    // 将 Agent 响应回传到外部平台（顺序发送保证消息顺序）
    if (data.messageIds && data.messageIds.length > 0) {
      (async () => {
        const msgs = await Promise.all(data.messageIds!.map(id => messageService.findById(id)));
        for (const msg of msgs) {
          if (msg?.content) {
            await bridgeService.sendAgentResponse(chatRoomId, data.agentName, msg.content, msg.id).catch(console.error);
          }
        }
        await bridgeService.clearTypingIndicators(chatRoomId).catch(console.error);
      })().catch(console.error);
    } else {
      bridgeService.clearTypingIndicators(chatRoomId).catch(console.error);
    }
  };

  // Emit streaming content
  const emitStream = (data: { messageId: string; agentId: string; agentName: string; content: string }, chatRoomId: string) => {
    io.to(chatRoomId).emit('agent:stream', data);
  };

  // Emit thinking content
  const emitThinking = (data: { messageId: string; agentId: string; agentName: string; thinking: string }, chatRoomId: string) => {
    io.to(chatRoomId).emit('agent:thinking', data);
  };

  // Emit tool call events
  const emitToolCall = (data: { messageId: string; agentId: string; agentName: string; toolCall: ToolCall }, chatRoomId: string) => {
    io.to(chatRoomId).emit('agent:tool_call', data);
  };

  // Emit agent status changes - 广播给所有用户，让离开群聊的用户也能收到状态更新
  const emitStatus = (data: { chatRoomId: string; statuses: Record<string, AgentStatus>; queueCounts?: Record<string, number> }, chatRoomId2: string) => {
    io.emit('agent:status', data);  // 广播给所有用户
  };

  // Broadcast task queue update to chatRoom
  const broadcastTaskQueue = (
    chatRoomId: string,
    agentId: string,
    tasks: { id: string; messageId: string; messageContent: string; status: string; createdAt: string }[],
  ) => {
    io.to(chatRoomId).emit('agent:task-queue', { chatRoomId, agentId, tasks });
  };

  // Broadcast todo created event to owner user
  const emitTodoCreated = (
    todo: {
      id: string;
      chatRoomId: string;
      messageId: string;
      triggerAgentId: string;
      triggerAgentName: string;
      ownerUserId: string;
      contentSummary: string;
      chatRoomName: string;
      status: string;
      createdAt: Date;
    },
    ownerUserId: string,
  ) => {
    // 找到群主的 socket，发送待办创建通知
    authService.findById(ownerUserId).then(user => {
      if (user?.socketId) {
        io.to(user.socketId).emit('todo:created', todo);
      }
    }).catch(err => {
      console.error('Failed to emit todo:created:', err);
    });
  };

  const emitChatRoomCreated = (chatRoom: any) => {
    io.emit('chatroom:created', { chatRoom });
  };

  // 推送所有正在执行的群聊状态给指定 socket
  async function pushAllExecutingStatuses(socket: AuthenticatedSocket) {
    try {
      // 获取所有群聊
      const chatRooms = await chatRoomService.findAll();

      for (const room of chatRooms) {
        // 获取每个群聊的 agent 状态
        const statuses = await getAgentStatuses(room.id);
        const statusObj: Record<string, AgentStatus> = {};
        const queueCounts: Record<string, number> = {};
        for (const [agentId, status] of statuses) {
          statusObj[agentId] = status;
          queueCounts[agentId] = await taskQueueService.getQueueLength(room.id, agentId);
        }

        // 检查是否有正在执行的 agent
        const hasExecuting = Object.values(statusObj).some(s => s === 'executing' || s === 'busy');
        if (hasExecuting) {
          socket.emit('agent:status', { chatRoomId: room.id, statuses: statusObj, queueCounts });
        }
      }
    } catch (error) {
      console.error('Error pushing executing statuses:', error);
    }
  }

  setupAIHandlers(emit, emitTyping, emitDone, emitStream, emitToolCall, emitThinking, emitStatus, broadcastTaskQueue, emitTodoCreated, emitChatRoomCreated);

  // Socket authentication middleware
  io.use(async (socket: AuthenticatedSocket, next) => {
    const token = socket.handshake.auth.token;

    if (!token) {
      return next(new Error('Authentication required'));
    }

    try {
      const decoded = jwt.verify(token, config.jwt.secret) as {
        userId: string;
        username: string;
      };

      const user = await authService.findById(decoded.userId);

      if (!user) {
        return next(new Error('用户不存在'));
      }

      // Store user info in socket data
      socket.data.user = {
        id: user.id,
        username: user.username,
        avatar: user.avatar,
        avatarColor: user.avatarColor,
      };

      // 让 socket 加入用户专属房间（支持同一用户多端连接）
      socket.join(`user:${user.id}`);

      // 更新 socket ID for the user（仍保留，用于某些场景的单点查询）
      await authService.updateSocketId(user.id, socket.id);

      next();
    } catch (err) {
      next(new Error('Invalid token'));
    }
  });

  io.on('connection', (socket: AuthenticatedSocket) => {
    console.log(`Client connected: ${socket.id}, user: ${socket.data.user?.username}`);
    socketChatRooms.set(socket.id, new Set());

    // Send joined confirmation
    socket.emit('joined', {
      socketId: socket.id,
      username: socket.data.user?.username,
      user: socket.data.user,
    });

    // 推送所有正在执行的群聊状态给新连接的用户
    pushAllExecutingStatuses(socket);

    // Create a new chatRoom (with owner)
    socket.on(
      'chatroom:create',
      async (data: {name: string; description?: string}) => {
        try {
          const user = socket.data.user;
          if (!user) {
            socket.emit('error', {
              message: 'User not authenticated',
            });
            return;
          }

          // Create chatRoom with owner
          const chatRoom = await chatRoomService.createWithOwner({
            name: data.name,
            description: data.description,
            ownerId: user.id,
          });

          if (!chatRoom) {
            socket.emit('error', {message: 'Failed to create chatRoom'});
            return;
          }

          // Join the socket to the chatRoom room
          socket.join(chatRoom.id);
          socketChatRooms.get(socket.id)?.add(chatRoom.id);

          socket.emit('chatroom:created', {chatRoom});
          // 广播给所有其他已连接客户端
          socket.broadcast.emit('chatroom:created', {chatRoom});
        } catch (error) {
          console.error('Error creating chatRoom:', error);
          socket.emit('error', {message: 'Failed to create chatRoom'});
        }
      },
    );

    // Join an existing chatRoom
    socket.on('chatroom:join', async (chatRoomId: string) => {
      try {
        const user = socket.data.user;
        if (!user) {
          socket.emit('error', {message: 'User not authenticated'});
          return;
        }

        // Check if user is an agent
        const isAgent = await chatRoomService.isAgent(
          chatRoomId,
          user.id,
        );
        if (!isAgent) {
          // Auto-add user as agent (MEMBER role)
          await chatRoomService.addAgent({
            chatRoomId,
            userId: user.id,
            role: 'MEMBER',
          });
        }

        // Join the socket room
        socket.join(chatRoomId);
        socketChatRooms.get(socket.id)?.add(chatRoomId);

        // Get chatRoom details with messages
        const chatRoom = await chatRoomService.findById(chatRoomId);

        socket.emit('chatroom:joined', {
          chatRoom,
          messages: chatRoom?.messages || [],
        });

        // 发送非活跃任务（interrupted + cancelled）
        const inactiveTasks = await taskQueueService.getInactiveTasks(chatRoomId);
        if (inactiveTasks.length > 0) {
          socket.emit('agent:inactive-tasks', {
            chatRoomId,
            tasks: inactiveTasks.map(task => ({
              id: task.id,
              agentId: task.agentId,
              agentName: task.agentName,
              messageId: task.messageId,
              messageContent: task.messageContent,
              status: task.status,
              createdAt: task.createdAt,
            })),
          });
        }

        // Notify others in the chatRoom
        socket.to(chatRoomId).emit('system', {
          text: `${user.username} joined the chatRoom`,
          chatRoomId,
        });
      } catch (error) {
        console.error('Error joining chatRoom:', error);
        socket.emit('error', {message: 'Failed to join chatRoom'});
      }
    });

    // Leave a chatRoom
    socket.on('chatroom:leave', async (chatRoomId: string) => {
      try {
        socket.leave(chatRoomId);
        socketChatRooms.get(socket.id)?.delete(chatRoomId);

        const user = socket.data.user;
        if (user) {
          socket.to(chatRoomId).emit('system', {
            text: `${user.username} left the chatRoom`,
            chatRoomId,
          });
        }

        socket.emit('chatroom:left', {chatRoomId});
      } catch (error) {
        console.error('Error leaving chatRoom:', error);
        socket.emit('error', {message: 'Failed to leave chatRoom'});
      }
    });

    // Get list of all chatRooms
    socket.on('chatroom:list', async () => {
      try {
        const chatRooms = await chatRoomService.findAll();
        socket.emit('chatroom:list', {chatRooms});
      } catch (error) {
        console.error('Error listing chatRooms:', error);
        socket.emit('error', {message: 'Failed to list chatRooms'});
      }
    });

    // Add agent to chatRoom
    socket.on(
      'chatroom:add-agent',
      async (data: {chatRoomId: string; agentId: string}) => {
        try {
          const user = socket.data.user;
          if (!user) {
            socket.emit('error', {
              message: 'User not authenticated',
            });
            return;
          }

          // Check if user is an agent of the chatRoom
          const isAgent = await chatRoomService.isAgent(
            data.chatRoomId,
            user.id,
          );
          if (!isAgent) {
            socket.emit('error', {
              message: 'You are not an agent of this chatRoom',
            });
            return;
          }

          const agent = await chatRoomService.addAgent({
            chatRoomId: data.chatRoomId,
            agentId: data.agentId,
          });

          // Notify all agents in the chatRoom
          io.to(data.chatRoomId).emit('chatroom:agent-added', {
            chatRoomId: data.chatRoomId,
            agent,
          });

          io.to(data.chatRoomId).emit('system', {
            text: `Agent has been added to the chatRoom`,
            chatRoomId: data.chatRoomId,
          });
        } catch (error) {
          console.error('Error adding agent:', error);
          socket.emit('error', {
            message: 'Failed to add agent to chatRoom',
          });
        }
      },
    );

    // Send message to chatRoom
    socket.on(
      'message',
      async (message: Message & {chatRoomId: string; attachments?: Attachment[]}) => {
        try {
          const user = socket.data.user;
          if (!user) {
            socket.emit('error', {
              message: 'User not authenticated',
            });
            return;
          }

          const {chatRoomId} = message;
          if (!chatRoomId) {
            socket.emit('error', {message: 'chatRoomId 是必填参数'});
            return;
          }

          // Check if user is an agent of the chatRoom
          const isAgent = await chatRoomService.isAgent(
            chatRoomId,
            user.id,
          );
          if (!isAgent) {
            socket.emit('error', {
              message: 'You are not an agent of this chatRoom',
            });
            return;
          }

          // Ensure time is valid
          const messageTime = message.time
            ? new Date(message.time)
            : new Date();
          const validTime = isNaN(messageTime.getTime())
            ? new Date()
            : messageTime;

          // Save message to database (with attachments if present)
          if (message.attachments && message.attachments.length > 0) {
            await messageService.createWithAttachments({
              id: message.id,
              type: message.type === 'reply' ? 'REPLY' : 'MESSAGE',
              content: message.content,
              time: validTime,
              userId: user.id,
              chatRoomId,
              replyMessageId: message.replyMessageId || null,
              isHuman: message.isHuman ?? true,
              attachments: message.attachments.map(att => ({
                type: att.type,
                filename: att.filename,
                mimeType: att.mimeType,
                size: att.size,
                url: att.url,
                width: att.width,
                height: att.height,
                durationMs: att.durationMs,
                transcript: att.transcript,
                waveform: att.waveform,
              })),
            });
          } else {
            await messageService.create({
              id: message.id,
              type: message.type === 'reply' ? 'REPLY' : 'MESSAGE',
              content: message.content,
              time: validTime,
              userId: user.id,
              chatRoomId,
              replyMessageId: message.replyMessageId || null,
              isHuman: message.isHuman ?? true,
            });
          }

          // Build message with user info
          const msgWithUser: Message = {
            ...message,
            time: validTime,
            user: user.username,
            userId: user.id,
            chatRoomId,
          };

          await emitMessageToChatRoomMembers(msgWithUser, chatRoomId);
          await bridgeService.syncRoomMessage(chatRoomId, user.username, message.content, message.id);

          // Trigger AI handlers
          messageEventEmitter.emit('receivedMessage', {
            message: msgWithUser,
            chatRoomId,
          });
        } catch (error) {
          console.error('Error sending message:', error);
          socket.emit('error', {message: 'Failed to send message'});
        }
      },
    );

    // Get agent statuses for a chatRoom
    socket.on('agent:status', async (chatRoomId: string) => {
      try {
        const statuses = await getAgentStatuses(chatRoomId);
        // Convert Map to object for JSON serialization
        const statusObj: Record<string, AgentStatus> = {};
        for (const [agentId, status] of statuses) {
          statusObj[agentId] = status;
        }
        socket.emit('agent:status', { chatRoomId, statuses: statusObj });

        // 发送非活跃任务（interrupted + cancelled）
        const inactiveTasks = await taskQueueService.getInactiveTasks(chatRoomId);
        if (inactiveTasks.length > 0) {
          socket.emit('agent:inactive-tasks', {
            chatRoomId,
            tasks: inactiveTasks.map(task => ({
              id: task.id,
              agentId: task.agentId,
              agentName: task.agentName,
              messageId: task.messageId,
              messageContent: task.messageContent,
              status: task.status,
              createdAt: task.createdAt,
            })),
          });
        }

        // 获取活跃任务并恢复状态
        const activeTasks = await taskQueueService.getActiveTasks(chatRoomId);
        for (const task of activeTasks) {
          // 检查该 agent 是否正在执行（状态为 executing 或 busy）
          if (statusObj[task.agentId] === 'executing' || statusObj[task.agentId] === 'busy') {
            // 发送恢复事件
            socket.emit('agent:resume', {
              messageId: task.messageId,
              agentId: task.agentId,
              agentName: task.agentName,
            });

            // 发送缓存的流式事件
            const cachedEvents = getCachedStreamEvents(chatRoomId, task.messageId, task.agentId);
            if (cachedEvents.length > 0) {
              socket.emit('agent:cached-events', {
                chatRoomId,
                messageId: task.messageId,
                agentId: task.agentId,
                events: cachedEvents,
              });
            }
          }
        }
      } catch (error) {
        console.error('Error getting agent statuses:', error);
        socket.emit('error', { message: 'Failed to get agent statuses' });
      }
    });

    // Stop agent execution
    socket.on('agent:stop', async (data: { chatRoomId: string; agentId: string }) => {
      try {
        const { chatRoomId, agentId } = data;
        console.log(`[agent:stop] 收到停止请求: chatRoomId=${chatRoomId}, agentId=${agentId}`);

        const stopped = stopAgentExecution(chatRoomId, agentId);

        if (stopped) {
          // 通知前端已停止
          socket.emit('agent:stopped', { chatRoomId, agentId });
          // 广播给群聊里的所有人
          socket.to(chatRoomId).emit('agent:stopped', { chatRoomId, agentId });
        } else {
          socket.emit('agent:stop-failed', {
            chatRoomId,
            agentId,
            message: '未找到正在执行的任务'
          });
        }
      } catch (error) {
        console.error('Error stopping agent:', error);
        socket.emit('error', { message: 'Failed to stop agent' });
      }
    });

    // Get agent task queue
    socket.on('agent:task-queue', async (data: { chatRoomId: string; agentId: string }) => {
      try {
        const { chatRoomId, agentId } = data;
        const tasks = await taskQueueService.getAgentQueue(chatRoomId, agentId);

        // 返回任务队列（包含状态信息和 agentName）
        const taskList = tasks.map(task => ({
          id: task.id,
          agentId: task.agentId,
          agentName: task.agentName,
          messageId: task.messageId,
          messageContent: task.messageContent,
          status: task.status,
          createdAt: task.createdAt,
        }));

        socket.emit('agent:task-queue', { chatRoomId, agentId, tasks: taskList });
      } catch (error) {
        console.error('Error getting task queue:', error);
        socket.emit('error', { message: 'Failed to get task queue' });
      }
    });

    // Cancel a pending task
    socket.on('agent:task-cancel', async (data: { chatRoomId: string; taskId: string }) => {
      try {
        const { chatRoomId, taskId } = data;
        const user = socket.data.user;
        if (!user) {
          socket.emit('agent:task-cancel-error', { error: '用户未认证' });
          return;
        }

        // 获取任务
        const task = await taskQueueService.getById(taskId);
        if (!task) {
          socket.emit('agent:task-cancel-error', { error: '任务不存在' });
          return;
        }

        // 验证 chatRoomId 匹配
        if (task.chatRoomId !== chatRoomId) {
          socket.emit('agent:task-cancel-error', { error: '任务不属于该群聊' });
          return;
        }

        // 只能取消 pending 状态的任务
        if (task.status !== 'pending') {
          socket.emit('agent:task-cancel-error', { error: '只能取消等待中的任务' });
          return;
        }

        // 标记任务为 cancelled
        await taskQueueService.updateStatus(taskId, 'cancelled');

        // 广播取消通知给群聊所有人
        io.to(chatRoomId).emit('agent:task-cancelled', {
          chatRoomId,
          agentId: task.agentId,
          taskId,
          messageId: task.messageId,
        });

        // 更新队列状态
        broadcastAgentStatus(chatRoomId);
      } catch (error) {
        console.error('Error cancelling task:', error);
        socket.emit('agent:task-cancel-error', { error: '取消任务失败' });
      }
    });

    // Resume an interrupted or cancelled task
    socket.on('agent:task-resume', async (data: { chatRoomId: string; taskId: string }) => {
      try {
        const { chatRoomId, taskId } = data;
        const user = socket.data.user;
        if (!user) {
          socket.emit('agent:task-resume-error', { error: '用户未认证' });
          return;
        }

        // 获取任务
        const task = await taskQueueService.getById(taskId);
        if (!task) {
          socket.emit('agent:task-resume-error', { error: '任务不存在' });
          return;
        }

        // 验证 chatRoomId 匹配
        if (task.chatRoomId !== chatRoomId) {
          socket.emit('agent:task-resume-error', { error: '任务不属于该群聊' });
          return;
        }

        // 只能恢复 interrupted 或 cancelled 状态的任务
        if (task.status !== 'interrupted' && task.status !== 'cancelled') {
          socket.emit('agent:task-resume-error', { error: '只能恢复中断或取消的任务' });
          return;
        }

        // 标记任务为 pending
        await taskQueueService.updateStatus(taskId, 'pending');

        // 广播恢复通知给群聊所有人
        io.to(chatRoomId).emit('agent:task-resumed', {
          chatRoomId,
          agentId: task.agentId,
          taskId,
        });

        // 触发队列处理
        processQueue(chatRoomId, task.agentId);
      } catch (error) {
        console.error('Error resuming task:', error);
        socket.emit('agent:task-resume-error', { error: '恢复任务失败' });
      }
    });

    // Get inactive tasks (interrupted + cancelled)
    socket.on('agent:inactive-tasks', async (chatRoomId: string) => {
      try {
        const tasks = await taskQueueService.getInactiveTasks(chatRoomId);

        const taskList = tasks.map(task => ({
          id: task.id,
          agentId: task.agentId,
          agentName: task.agentName,
          messageId: task.messageId,
          messageContent: task.messageContent,
          status: task.status,
          createdAt: task.createdAt,
        }));

        socket.emit('agent:inactive-tasks', { chatRoomId, tasks: taskList });
      } catch (error) {
        console.error('Error getting inactive tasks:', error);
        socket.emit('error', { message: 'Failed to get inactive tasks' });
      }
    });

    // Mark chatRoom as read - update lastReadAt
    socket.on('chatroom:mark-read', async (chatRoomId: string) => {
      try {
        const user = socket.data.user;
        if (!user) {
          socket.emit('error', { message: 'User not authenticated' });
          return;
        }

        await chatRoomService.updateLastReadAt(chatRoomId, user.id);

        // 广播给该用户所有端（user:{userId} 房间）
        const unreadCount = await chatRoomService.getUnreadCount(chatRoomId, user.id);
        io.to(`user:${user.id}`).emit('unread:update', { chatRoomId, count: unreadCount });
      } catch (error) {
        console.error('Error marking chatRoom as read:', error);
        socket.emit('error', { message: 'Failed to mark chatRoom as read' });
      }
    });

    // Request unread counts for all chatRooms
    socket.on('unread:request', async () => {
      try {
        const user = socket.data.user;
        if (!user) {
          socket.emit('error', { message: 'User not authenticated' });
          return;
        }

        const unreadCounts = await chatRoomService.getAllUnreadCounts(user.id);
        socket.emit('unread:update', { unreadCounts });
      } catch (error) {
        console.error('Error getting unread counts:', error);
        socket.emit('error', { message: 'Failed to get unread counts' });
      }
    });

    // Todo: Request all todos for the current user
    socket.on('todo:request', async () => {
      try {
        const user = socket.data.user;
        if (!user) {
          socket.emit('error', { message: 'User not authenticated' });
          return;
        }

        const todos = await todoService.getByOwnerUserId(user.id, 'pending');
        socket.emit('todo:list', { todos });
      } catch (error) {
        console.error('Error getting todos:', error);
        socket.emit('error', { message: 'Failed to get todos' });
      }
    });

    // Todo: Complete a todo
    socket.on('todo:complete', async (data: { todoId: string }) => {
      try {
        const user = socket.data.user;
        if (!user) {
          socket.emit('error', { message: 'User not authenticated' });
          return;
        }

        const todo = await todoService.getById(data.todoId);
        if (!todo || todo.ownerUserId !== user.id) {
          socket.emit('error', { message: '待办不存在或无权限' });
          return;
        }

        await todoService.complete(data.todoId);
        socket.emit('todo:updated', { todoId: data.todoId, status: 'completed' });
      } catch (error) {
        console.error('Error completing todo:', error);
        socket.emit('error', { message: 'Failed to complete todo' });
      }
    });

    // Todo: Dismiss a todo
    socket.on('todo:dismiss', async (data: { todoId: string }) => {
      try {
        const user = socket.data.user;
        if (!user) {
          socket.emit('error', { message: 'User not authenticated' });
          return;
        }

        const todo = await todoService.getById(data.todoId);
        if (!todo || todo.ownerUserId !== user.id) {
          socket.emit('error', { message: '待办不存在或无权限' });
          return;
        }

        await todoService.dismiss(data.todoId);
        socket.emit('todo:updated', { todoId: data.todoId, status: 'dismissed' });
      } catch (error) {
        console.error('Error dismissing todo:', error);
        socket.emit('error', { message: 'Failed to dismiss todo' });
      }
    });

    // Disconnect
    socket.on('disconnect', async () => {
      const user = socket.data.user;

      // Leave all chatRoom rooms
      const chatRooms = socketChatRooms.get(socket.id);
      if (chatRooms) {
        for (const chatRoomId of chatRooms) {
          if (user) {
            socket.to(chatRoomId).emit('system', {
              text: `${user.username} disconnected`,
              chatRoomId,
            });
          }
        }
      }

      socketChatRooms.delete(socket.id);

      // Clear socket ID but keep user record
      if (user) {
        await userService.clearSocket(socket.id);
      }

      console.log(`Client disconnected: ${socket.id}`);
    });
  });
}
