import {
  BaseCheckpointSaver,
  type Checkpoint,
  type CheckpointListOptions,
  type CheckpointMetadata,
  type CheckpointTuple,
  type PendingWrite,
  TASKS,
  copyCheckpoint,
  maxChannelVersion,
} from '@langchain/langgraph-checkpoint';
import type { ChannelVersions } from '@langchain/langgraph-checkpoint';
import { Client } from '@libsql/client';
import type { InValue } from '@libsql/client';
import { getLibSqlClient } from './libsql-client.js';

// 使用宽松的 RunnableConfig 类型以避免版本不匹配问题
type RunnableConfig = {
  configurable?: {
    thread_id?: string;
    checkpoint_ns?: string;
    checkpoint_id?: string;
  };
};

/**
 * Checkpoint 行数据结构
 */
interface CheckpointRow {
  thread_id: string;
  checkpoint_ns: string;
  checkpoint_id: string;
  parent_checkpoint_id?: string;
  type?: string;
  checkpoint: Uint8Array;
  metadata: Uint8Array;
  pending_writes: string;
}

/**
 * Pending Write 列结构
 */
interface PendingWriteColumn {
  task_id: string;
  channel: string;
  type?: string;
  value: string;
}

/**
 * Pending Send 列结构
 */
interface PendingSendColumn {
  type: string;
  value: string;
}

/**
 * LibSqlCheckpointer - 基于 libsql 的 LangGraph checkpoint 持久化实现
 *
 * 参考 @langchain/langgraph-checkpoint-sqlite 的 SqliteSaver 实现
 * 使用异步 libsql API，与项目架构保持一致
 */
export class LibSqlCheckpointer extends BaseCheckpointSaver {
  private client: Client;
  protected isSetup: boolean = false;

  constructor(client: Client) {
    super();
    this.client = client;
  }

  /**
   * 获取单例实例
   */
  static getInstance(): LibSqlCheckpointer {
    return new LibSqlCheckpointer(getLibSqlClient());
  }

  /**
   * 初始化数据库表
   * 创建 checkpoints 和 writes 表
   */
  protected async setup(): Promise<void> {
    if (this.isSetup) return;

    await this.client.execute('PRAGMA journal_mode=WAL');
    await this.client.execute('PRAGMA busy_timeout=5000');

    // 创建 checkpoints 表
    await this.client.execute(`
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

    // 创建 writes 表
    await this.client.execute(`
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

    this.isSetup = true;
  }

  /**
   * 获取指定配置的 checkpoint tuple
   */
  async getTuple(config: RunnableConfig): Promise<CheckpointTuple | undefined> {
    await this.setup();

    const {
      thread_id,
      checkpoint_ns = '',
      checkpoint_id,
    } = config.configurable ?? {};

    if (!thread_id) {
      return undefined;
    }

    // 构建查询 SQL
    const sql = `
      SELECT
        thread_id,
        checkpoint_ns,
        checkpoint_id,
        parent_checkpoint_id,
        type,
        checkpoint,
        metadata,
        (
          SELECT
            json_group_array(
              json_object(
                'task_id', pw.task_id,
                'channel', pw.channel,
                'type', pw.type,
                'value', CAST(pw.value AS TEXT)
              )
            )
          FROM writes as pw
          WHERE pw.thread_id = checkpoints.thread_id
            AND pw.checkpoint_ns = checkpoints.checkpoint_ns
            AND pw.checkpoint_id = checkpoints.checkpoint_id
        ) as pending_writes
      FROM checkpoints
      WHERE thread_id = ? AND checkpoint_ns = ?
      ${checkpoint_id ? 'AND checkpoint_id = ?' : 'ORDER BY checkpoint_id DESC LIMIT 1'}
    `;

    const args: InValue[] = [thread_id, checkpoint_ns];
    if (checkpoint_id) {
      args.push(checkpoint_id);
    }

    const result = await this.client.execute({ sql, args });
    const row = result.rows[0];

    if (!row) return undefined;

    const checkpointRow = this.rowToCheckpointRow(row);

    let finalConfig = config;
    if (!checkpoint_id) {
      finalConfig = {
        configurable: {
          thread_id: checkpointRow.thread_id,
          checkpoint_ns,
          checkpoint_id: checkpointRow.checkpoint_id,
        },
      };
    }

    if (
      finalConfig.configurable?.thread_id === undefined ||
      finalConfig.configurable?.checkpoint_id === undefined
    ) {
      throw new Error('Missing thread_id or checkpoint_id');
    }

    // 解析 pending writes
    const pendingWrites: [string, string, unknown][] = await Promise.all(
      (JSON.parse(checkpointRow.pending_writes || '[]') as PendingWriteColumn[]).map(
        async (write) => {
          return [
            write.task_id,
            write.channel,
            await this.serde.loadsTyped(write.type ?? 'json', write.value ?? ''),
          ] as [string, string, unknown];
        }
      )
    );

    // 加载 checkpoint
    const checkpoint = (await this.serde.loadsTyped(
      checkpointRow.type ?? 'json',
      checkpointRow.checkpoint
    )) as Checkpoint;

    // 处理旧版本 checkpoint 的 pending sends
    if (checkpoint.v < 4 && checkpointRow.parent_checkpoint_id != null) {
      await this.migratePendingSends(
        checkpoint,
        checkpointRow.thread_id,
        checkpointRow.parent_checkpoint_id
      );
    }

    return {
      checkpoint,
      config: finalConfig,
      metadata: (await this.serde.loadsTyped(
        checkpointRow.type ?? 'json',
        checkpointRow.metadata
      )) as CheckpointMetadata,
      parentConfig: checkpointRow.parent_checkpoint_id
        ? {
            configurable: {
              thread_id: checkpointRow.thread_id,
              checkpoint_ns,
              checkpoint_id: checkpointRow.parent_checkpoint_id,
            },
          }
        : undefined,
      pendingWrites,
    };
  }

  /**
   * 遍历所有 checkpoints
   */
  async *list(
    config: RunnableConfig,
    options?: CheckpointListOptions
  ): AsyncGenerator<CheckpointTuple> {
    const { limit, before, filter } = options ?? {};
    await this.setup();

    const thread_id = config.configurable?.thread_id;
    const checkpoint_ns = config.configurable?.checkpoint_ns;

    // 构建查询 SQL
    let sql = `
      SELECT
        thread_id,
        checkpoint_ns,
        checkpoint_id,
        parent_checkpoint_id,
        type,
        checkpoint,
        metadata,
        (
          SELECT
            json_group_array(
              json_object(
                'task_id', pw.task_id,
                'channel', pw.channel,
                'type', pw.type,
                'value', CAST(pw.value AS TEXT)
              )
            )
          FROM writes as pw
          WHERE pw.thread_id = checkpoints.thread_id
            AND pw.checkpoint_ns = checkpoints.checkpoint_ns
            AND pw.checkpoint_id = checkpoints.checkpoint_id
        ) as pending_writes
      FROM checkpoints
    `;

    const whereClause: string[] = [];
    const args: InValue[] = [];

    if (thread_id) {
      whereClause.push('thread_id = ?');
      args.push(thread_id);
    }

    if (checkpoint_ns !== undefined && checkpoint_ns !== null) {
      whereClause.push('checkpoint_ns = ?');
      args.push(checkpoint_ns);
    }

    if (before?.configurable?.checkpoint_id !== undefined) {
      whereClause.push('checkpoint_id < ?');
      args.push(before.configurable.checkpoint_id);
    }

    if (whereClause.length > 0) {
      sql += `WHERE ${whereClause.join(' AND ')}\n`;
    }

    sql += 'ORDER BY checkpoint_id DESC';

    if (limit) {
      sql += ` LIMIT ${parseInt(String(limit), 10)}`;
    }

    const result = await this.client.execute({ sql, args });

    for (const row of result.rows) {
      const checkpointRow = this.rowToCheckpointRow(row);

      const pendingWrites: [string, string, unknown][] = await Promise.all(
        (JSON.parse(checkpointRow.pending_writes || '[]') as PendingWriteColumn[]).map(
          async (write) => {
            return [
              write.task_id,
              write.channel,
              await this.serde.loadsTyped(write.type ?? 'json', write.value ?? ''),
            ] as [string, string, unknown];
          }
        )
      );

      const checkpoint = (await this.serde.loadsTyped(
        checkpointRow.type ?? 'json',
        checkpointRow.checkpoint
      )) as Checkpoint;

      if (checkpoint.v < 4 && checkpointRow.parent_checkpoint_id != null) {
        await this.migratePendingSends(
          checkpoint,
          checkpointRow.thread_id,
          checkpointRow.parent_checkpoint_id
        );
      }

      yield {
        config: {
          configurable: {
            thread_id: checkpointRow.thread_id,
            checkpoint_ns: checkpointRow.checkpoint_ns,
            checkpoint_id: checkpointRow.checkpoint_id,
          },
        },
        checkpoint,
        metadata: (await this.serde.loadsTyped(
          checkpointRow.type ?? 'json',
          checkpointRow.metadata
        )) as CheckpointMetadata,
        parentConfig: checkpointRow.parent_checkpoint_id
          ? {
              configurable: {
                thread_id: checkpointRow.thread_id,
                checkpoint_ns: checkpointRow.checkpoint_ns,
                checkpoint_id: checkpointRow.parent_checkpoint_id,
              },
            }
          : undefined,
        pendingWrites,
      };
    }
  }

  /**
   * 存储 checkpoint
   */
  async put(
    config: RunnableConfig,
    checkpoint: Checkpoint,
    metadata: CheckpointMetadata,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _newVersions: ChannelVersions
  ): Promise<RunnableConfig> {
    await this.setup();

    if (!config.configurable) {
      throw new Error('Empty configuration supplied.');
    }

    const thread_id = config.configurable?.thread_id;
    const checkpoint_ns = config.configurable?.checkpoint_ns ?? '';
    const parent_checkpoint_id = config.configurable?.checkpoint_id;

    if (!thread_id) {
      throw new Error(`Missing "thread_id" field in passed "config.configurable".`);
    }

    // 复制 checkpoint 以准备序列化
    const preparedCheckpoint: Partial<Checkpoint> = copyCheckpoint(checkpoint);

    // 序列化 checkpoint 和 metadata
    const [[type1, serializedCheckpoint], [type2, serializedMetadata]] =
      await Promise.all([
        this.serde.dumpsTyped(preparedCheckpoint),
        this.serde.dumpsTyped(metadata),
      ]);

    if (type1 !== type2) {
      throw new Error('Failed to serialize checkpoint and metadata to the same type.');
    }

    // 插入 checkpoint
    await this.client.execute({
      sql: `INSERT OR REPLACE INTO checkpoints
            (thread_id, checkpoint_ns, checkpoint_id, parent_checkpoint_id, type, checkpoint, metadata)
            VALUES (?, ?, ?, ?, ?, ?, ?)`,
      args: [
        thread_id,
        checkpoint_ns,
        checkpoint.id,
        parent_checkpoint_id ?? null,
        type1,
        serializedCheckpoint,
        serializedMetadata,
      ],
    });

    return {
      configurable: {
        thread_id,
        checkpoint_ns,
        checkpoint_id: checkpoint.id,
      },
    };
  }

  /**
   * 存储 pending writes
   */
  async putWrites(
    config: RunnableConfig,
    writes: PendingWrite[],
    taskId: string
  ): Promise<void> {
    await this.setup();

    if (!config.configurable) {
      throw new Error('Empty configuration supplied.');
    }

    if (!config.configurable?.thread_id) {
      throw new Error('Missing thread_id field in config.configurable.');
    }

    if (!config.configurable?.checkpoint_id) {
      throw new Error('Missing checkpoint_id field in config.configurable.');
    }

    const thread_id = config.configurable.thread_id;
    const checkpoint_ns = config.configurable.checkpoint_ns ?? '';
    const checkpoint_id = config.configurable.checkpoint_id;

    // 批量插入 writes
    for (const [idx, write] of writes.entries()) {
      const [type, serializedWrite] = await this.serde.dumpsTyped(write[1]);

      await this.client.execute({
        sql: `INSERT OR REPLACE INTO writes
              (thread_id, checkpoint_ns, checkpoint_id, task_id, idx, channel, type, value)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          thread_id,
          checkpoint_ns,
          checkpoint_id,
          taskId,
          idx,
          write[0],
          type,
          serializedWrite,
        ],
      });
    }
  }

  /**
   * 删除指定 thread 的所有 checkpoints
   */
  async deleteThread(threadId: string): Promise<void> {
    await this.setup();

    await this.client.execute({
      sql: `DELETE FROM checkpoints WHERE thread_id = ?`,
      args: [threadId],
    });

    await this.client.execute({
      sql: `DELETE FROM writes WHERE thread_id = ?`,
      args: [threadId],
    });
  }

  /**
   * 将 libsql 结果行转换为 CheckpointRow
   */
  private rowToCheckpointRow(row: Record<string, unknown>): CheckpointRow {
    return {
      thread_id: String(row.thread_id ?? ''),
      checkpoint_ns: String(row.checkpoint_ns ?? ''),
      checkpoint_id: String(row.checkpoint_id ?? ''),
      parent_checkpoint_id: row.parent_checkpoint_id
        ? String(row.parent_checkpoint_id)
        : undefined,
      type: row.type ? String(row.type) : undefined,
      checkpoint: this.toUint8Array(row.checkpoint),
      metadata: this.toUint8Array(row.metadata),
      pending_writes: String(row.pending_writes ?? '[]'),
    };
  }

  /**
   * 将各种格式转换为 Uint8Array
   */
  private toUint8Array(data: unknown): Uint8Array {
    if (data instanceof Uint8Array) {
      return data;
    }
    if (data instanceof ArrayBuffer) {
      return new Uint8Array(data);
    }
    if (typeof data === 'string') {
      // Base64 解码
      return Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
    }
    if (Array.isArray(data)) {
      return new Uint8Array(data as number[]);
    }
    return new Uint8Array();
  }

  /**
   * 迁移旧版本 checkpoint 的 pending sends
   */
  protected async migratePendingSends(
    checkpoint: Checkpoint,
    threadId: string,
    parentCheckpointId: string
  ): Promise<void> {
    const result = await this.client.execute({
      sql: `
        SELECT
          json_group_array(
            json_object(
              'type', ps.type,
              'value', CAST(ps.value AS TEXT)
            )
          ) as pending_sends
        FROM writes as ps
        WHERE ps.thread_id = ?
          AND ps.checkpoint_id = ?
          AND ps.channel = '${TASKS}'
        ORDER BY ps.idx
      `,
      args: [threadId, parentCheckpointId],
    });

    const row = result.rows[0];
    if (!row) return;

    const mutableCheckpoint = checkpoint;

    // 添加 pending sends 到 checkpoint
    mutableCheckpoint.channel_values ??= {};
    mutableCheckpoint.channel_values[TASKS] = await Promise.all(
      JSON.parse(String(row.pending_sends || '[]')).map(
        ({ type, value }: PendingSendColumn) => this.serde.loadsTyped(type, value)
      )
    );

    // 添加到 versions
    mutableCheckpoint.channel_versions[TASKS] =
      Object.keys(checkpoint.channel_versions).length > 0
        ? maxChannelVersion(...Object.values(checkpoint.channel_versions))
        : this.getNextVersion(undefined);
  }
}

export const checkpointer = LibSqlCheckpointer.getInstance();