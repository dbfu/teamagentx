import type { z } from 'zod';

export type SystemTool<Input = unknown> = {
  name: string;
  description: string;
  schema: z.ZodType<Input>;
  invoke(input: Input): Promise<unknown>;
};

export function createSystemTool<Input>(
  handler: (input: Input) => Promise<unknown> | unknown,
  config: {
    name: string;
    description: string;
    schema: z.ZodType<Input>;
  },
): SystemTool<Input> {
  return {
    name: config.name,
    description: config.description,
    schema: config.schema,
    async invoke(input: Input): Promise<unknown> {
      return handler(input);
    },
  };
}
