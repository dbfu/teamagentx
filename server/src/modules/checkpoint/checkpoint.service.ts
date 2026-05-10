import { getLibSqlClient } from '../../lib/libsql-client.js';

/**
 * Checkpoint 消息类型
 */
export interface CheckpointMessage {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  timestamp?: number;
}

/**
 * Checkpoint 详情
 */
export interface CheckpointDetail {
  checkpointId: string;
  messages: CheckpointMessage[];
  createdAt?: string;
}

/**
 * Checkpoint 服务
 * 管理 LangGraph checkpoint 数据的清理和查询
 */
export const checkpointService = {
  /**
   * 确保 checkpoints 和 writes 表存在
   */
  async ensureTablesExist(): Promise<void> {
    const client = getLibSqlClient();

    await client.execute(`
      CREATE TABLE IF NOT EXISTS checkpoints (
        thread_id TEXT NOT NULL,
        checkpoint_ns TEXT NOT NULL DEFAULT '',
        checkpoint_id TEXT NOT NULL,
        parent_checkpoint_id TEXT,
        type TEXT,
        checkpoint BLOB,
        metadata BLOB,
        PRIMARY KEY (thread_id, checkpoint_ns, checkpoint_id)
      )
    `);

    await client.execute(`
      CREATE TABLE IF NOT EXISTS writes (
        thread_id TEXT NOT NULL,
        checkpoint_ns TEXT NOT NULL DEFAULT '',
        checkpoint_id TEXT NOT NULL,
        task_id TEXT NOT NULL,
        idx INTEGER NOT NULL,
        channel TEXT NOT NULL,
        type TEXT,
        value BLOB,
        PRIMARY KEY (thread_id, checkpoint_ns, checkpoint_id, task_id, idx)
      )
    `);
  },

  /**
   * 清空指定助手的所有上下文（checkpoint 数据）
   * thread_id 格式为: ${chatRoomId}_${agentName} 或 ${chatRoomId}_${agentName}_${sessionDir}
   *
   * @param agentName 助手名称
   */
  async clearAgentContext(agentName: string): Promise<void> {
    const client = getLibSqlClient();

    // 确保表存在
    await this.ensureTablesExist();

    // 删除所有匹配该助手名称的 checkpoints
    // 使用 LIKE 查询匹配 thread_id 中包含该助手名称的记录
    // thread_id 格式: chatRoomId_agentName 或 chatRoomId_agentName_sessionDir
    const pattern = `%_${agentName}%`;

    await client.execute({
      sql: `DELETE FROM checkpoints WHERE thread_id LIKE ?`,
      args: [pattern],
    });

    // 删除对应的 writes
    await client.execute({
      sql: `DELETE FROM writes WHERE thread_id LIKE ?`,
      args: [pattern],
    });

    console.log(`[CheckpointService] 已清空助手 ${agentName} 的所有上下文`);
  },

  /**
   * 清空指定群聊中指定助手的上下文
   *
   * @param chatRoomId 群聊 ID
   * @param agentName 助手名称
   */
  async clearChatRoomAgentContext(
    chatRoomId: string,
    agentName: string
  ): Promise<void> {
    const client = getLibSqlClient();

    // thread_id 格式: chatRoomId_agentName 或 chatRoomId_agentName_sessionDir
    const pattern = `${chatRoomId}_${agentName}%`;

    await client.execute({
      sql: `DELETE FROM checkpoints WHERE thread_id LIKE ?`,
      args: [pattern],
    });

    await client.execute({
      sql: `DELETE FROM writes WHERE thread_id LIKE ?`,
      args: [pattern],
    });

    console.log(
      `[CheckpointService] 已清空群聊 ${chatRoomId} 中助手 ${agentName} 的上下文`
    );
  },

  /**
   * 获取指定助手的 checkpoint 统计信息
   *
   * @param agentName 助手名称
   */
  async getAgentCheckpointStats(agentName: string): Promise<{
    checkpointCount: number;
    writeCount: number;
  }> {
    const client = getLibSqlClient();
    const pattern = `%_${agentName}%`;

    const checkpointResult = await client.execute({
      sql: `SELECT COUNT(*) as count FROM checkpoints WHERE thread_id LIKE ?`,
      args: [pattern],
    });

    const writeResult = await client.execute({
      sql: `SELECT COUNT(*) as count FROM writes WHERE thread_id LIKE ?`,
      args: [pattern],
    });

    return {
      checkpointCount: Number(checkpointResult.rows[0]?.count ?? 0),
      writeCount: Number(writeResult.rows[0]?.count ?? 0),
    };
  },

  /**
   * 获取指定 thread 的 checkpoint 统计信息
   *
   * @param threadId thread ID（完整格式：chatRoomId_agentName_workDir）
   */
  async getCheckpointStats(threadId: string): Promise<{
    count: number;
    latestCheckpointId: string | null;
    threadId: string;
  }> {
    const client = getLibSqlClient();

    await this.ensureTablesExist();

    const countResult = await client.execute({
      sql: `SELECT COUNT(*) as count FROM checkpoints WHERE thread_id = ?`,
      args: [threadId],
    });

    const latestResult = await client.execute({
      sql: `SELECT checkpoint_id FROM checkpoints WHERE thread_id = ? ORDER BY checkpoint_id DESC LIMIT 1`,
      args: [threadId],
    });

    return {
      count: Number(countResult.rows[0]?.count ?? 0),
      latestCheckpointId: latestResult.rows[0]?.checkpoint_id
        ? String(latestResult.rows[0].checkpoint_id)
        : null,
      threadId,
    };
  },

  /**
   * 根据群聊和助手名称获取 checkpoint 统计信息
   * thread_id 格式为: ${chatRoomId}_${agentName}_${workDir}
   *
   * @param chatRoomId 群聊 ID
   * @param agentName 助手名称
   */
  async getCheckpointStatsByChatRoom(
    chatRoomId: string,
    agentName: string
  ): Promise<{
    count: number;
    latestCheckpointId: string | null;
    threadId: string;
  }> {
    const client = getLibSqlClient();

    await this.ensureTablesExist();

    // 先查询实际的 thread_id（格式：chatRoomId_agentName_workDir）
    const threadResult = await client.execute({
      sql: `SELECT DISTINCT thread_id FROM checkpoints WHERE thread_id LIKE ? LIMIT 1`,
      args: [`${chatRoomId}_${agentName}%`],
    });

    const threadId = threadResult.rows[0]?.thread_id
      ? String(threadResult.rows[0].thread_id)
      : `${chatRoomId}_${agentName}`;

    // 使用实际的 thread_id 精确查询
    const countResult = await client.execute({
      sql: `SELECT COUNT(*) as count FROM checkpoints WHERE thread_id = ?`,
      args: [threadId],
    });

    const latestResult = await client.execute({
      sql: `SELECT checkpoint_id FROM checkpoints WHERE thread_id = ? ORDER BY checkpoint_id DESC LIMIT 1`,
      args: [threadId],
    });

    return {
      count: Number(countResult.rows[0]?.count ?? 0),
      latestCheckpointId: latestResult.rows[0]?.checkpoint_id
        ? String(latestResult.rows[0].checkpoint_id)
        : null,
      threadId,
    };
  },

  /**
   * 获取 checkpoint 中的消息历史
   *
   * @param threadId thread ID（完整格式）
   * @param limit 限制返回的 checkpoint 数量（默认最新一个）
   */
  async getCheckpointMessages(
    threadId: string,
    limit: number = 1
  ): Promise<CheckpointDetail[]> {
    const client = getLibSqlClient();

    await this.ensureTablesExist();

    // 精确匹配
    const result = await client.execute({
      sql: `
        SELECT checkpoint_id, checkpoint, metadata
        FROM checkpoints
        WHERE thread_id = ?
        ORDER BY checkpoint_id DESC
        LIMIT ?
      `,
      args: [threadId, limit],
    });

    const checkpoints: CheckpointDetail[] = [];

    for (const row of result.rows) {
      try {
        // libsql 返回的 BLOB 类型可能是 ArrayBuffer、Uint8Array、Buffer 或 string/number/bigint
        const checkpointRaw = row.checkpoint;
        let checkpointData: Uint8Array;

        if (checkpointRaw instanceof Uint8Array) {
          checkpointData = checkpointRaw;
        } else if (checkpointRaw instanceof ArrayBuffer) {
          checkpointData = new Uint8Array(checkpointRaw);
        } else if (typeof checkpointRaw === 'string') {
          // 如果是 base64 编码的字符串
          checkpointData = Uint8Array.from(atob(checkpointRaw), (c) => c.charCodeAt(0));
        } else if (typeof checkpointRaw === 'number' || typeof checkpointRaw === 'bigint') {
          // 不太可能，但作为兜底处理
          checkpointData = new Uint8Array();
        } else if (Buffer.isBuffer(checkpointRaw)) {
          // Node.js Buffer
          checkpointData = new Uint8Array(checkpointRaw);
        } else {
          // 其他情况，尝试作为 ArrayBuffer 处理
          checkpointData = new Uint8Array(checkpointRaw as unknown as ArrayBuffer);
        }

        // 解析 checkpoint BLOB 数据（JSON 格式）
        const checkpoint = JSON.parse(new TextDecoder().decode(checkpointData));

        // 从 channel_values 中提取消息
        const messages: CheckpointMessage[] = [];
        if (checkpoint.channel_values?.messages) {
          for (const msg of checkpoint.channel_values.messages) {
            // 提取消息角色和内容
            let role: CheckpointMessage['role'] = 'user';
            const msgType = msg._getType?.() || msg.type || 'unknown';

            if (msgType === 'ai' || msgType === 'AIMessageChunk') {
              role = 'assistant';
            } else if (msgType === 'system') {
              role = 'system';
            } else if (msgType === 'tool') {
              role = 'tool';
            }

            // 提取内容
            let content = '';
            if (typeof msg.content === 'string') {
              content = msg.content;
            } else if (Array.isArray(msg.content)) {
              // 多模态消息，提取文本部分
              content = msg.content
                .filter((c: any) => c.type === 'text')
                .map((c: any) => c.text)
                .join('\n');
            }

            if (content) {
              messages.push({
                role,
                content: content.slice(0, 500), // 限制每条消息长度
              });
            }
          }
        }

        checkpoints.push({
          checkpointId: String(row.checkpoint_id),
          messages,
        });
      } catch (e) {
        console.error('[CheckpointService] 解析 checkpoint 失败:', e);
      }
    }

    return checkpoints;
  },
};