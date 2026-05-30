import { z } from 'zod';
import prisma from '../../../lib/prisma.js';
import { createSystemTool as tool } from './system-tool.js';

function parseEvents(eventsStr: string): unknown[] {
  try {
    const parsed = JSON.parse(eventsStr);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function createExecutionContextTools(chatRoomId: string) {
  return [
    tool(
      async (input: { agentName: string }) => {
        const records = await prisma.executionRecord.findMany({
          where: { chatRoomId, agentName: input.agentName },
          orderBy: { createdAt: 'desc' },
        });

        if (records.length === 0) {
          return {
            chatRoomScope: 'current',
            agentName: input.agentName,
            found: false,
            records: [],
          };
        }

        return {
          chatRoomScope: 'current',
          agentName: input.agentName,
          found: true,
          totalRecords: records.length,
          records: records.map((r) => ({
            executionId: r.id,
            createdAt: r.createdAt instanceof Date ? r.createdAt.toISOString() : r.createdAt,
            status: r.status,
            duration: r.duration,
            triggerMessage: r.triggerMessage,
            errorMessage: r.errorMessage,
            events: parseEvents(r.events),
          })),
        };
      },
      {
        name: 'get_agent_execution_context',
        description:
          'Retrieve the full execution history of a specific assistant in the current chatroom. **Only call this tool when the user explicitly asks to inspect, review, or summarize an assistant\'s execution context or problems.** Do not call proactively; this tool returns large payloads and should be used sparingly.',
        schema: z.object({
          agentName: z.string().min(1).describe('The name of the assistant whose execution context to retrieve.'),
        }),
      },
    ),
  ];
}
