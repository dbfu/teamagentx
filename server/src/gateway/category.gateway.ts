import { FastifyInstance } from 'fastify';
import { categoryService } from '../modules/category/category.service.js';

// JSON Schema for response
const categoryResponseSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    name: { type: 'string' },
    description: { type: 'string', nullable: true },
    sortOrder: { type: 'integer' },
    createdAt: { type: 'string' },
    updatedAt: { type: 'string' },
  },
};

const categoryWithCountResponseSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    name: { type: 'string' },
    description: { type: 'string', nullable: true },
    sortOrder: { type: 'integer' },
    createdAt: { type: 'string' },
    updatedAt: { type: 'string' },
    _count: {
      type: 'object',
      properties: {
        agents: { type: 'integer' },
      },
    },
  },
};

const createCategoryBodySchema = {
  type: 'object',
  required: ['name'],
  properties: {
    name: { type: 'string', description: '分类名称（唯一）' },
    description: { type: 'string', description: '分类描述' },
    sortOrder: { type: 'integer', description: '排序顺序' },
  },
};

const updateCategoryBodySchema = {
  type: 'object',
  properties: {
    name: { type: 'string' },
    description: { type: 'string' },
    sortOrder: { type: 'integer' },
  },
};

interface CreateCategoryBody {
  name: string;
  description?: string;
  sortOrder?: number;
}

interface UpdateCategoryBody {
  name?: string;
  description?: string;
  sortOrder?: number;
}

interface CategoryParams {
  id: string;
}

export async function categoryGateway(app: FastifyInstance) {
  // 获取所有分类列表
  app.get(
    '/categories',
    {
      schema: {
        description: '获取所有助手分类列表',
        tags: ['Categories'],
        response: {
          200: {
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              data: { type: 'array', items: categoryWithCountResponseSchema },
            },
          },
        },
      },
    },
    async (_request, reply) => {
      const categories = await categoryService.findAll();
      return reply.send({ success: true, data: categories });
    }
  );

  // 批量更新分类排序
  app.put<{ Body: { items: { id: string; sortOrder: number }[] } }>(
    '/categories/sort-order',
    {
      schema: {
        description: '批量更新分类排序顺序',
        tags: ['Categories'],
        body: {
          type: 'object',
          required: ['items'],
          properties: {
            items: {
              type: 'array',
              items: {
                type: 'object',
                required: ['id', 'sortOrder'],
                properties: {
                  id: { type: 'string' },
                  sortOrder: { type: 'integer' },
                },
              },
            },
          },
        },
        response: {
          200: {
            type: 'object',
            properties: {
              success: { type: 'boolean' },
            },
          },
        },
      },
    },
    async (request, reply) => {
      await categoryService.reorderBatch(request.body.items);
      return reply.send({ success: true });
    }
  );

  // 获取单个分类（包含该分类下的助手）
  app.get<{ Params: CategoryParams }>(
    '/categories/:id',
    {
      schema: {
        description: '根据 ID 获取单个分类及其助手',
        tags: ['Categories'],
        params: {
          type: 'object',
          properties: { id: { type: 'string' } },
        },
        response: {
          200: {
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              data: {
                type: 'object',
                properties: {
                  id: { type: 'string' },
                  name: { type: 'string' },
                  description: { type: 'string', nullable: true },
                  sortOrder: { type: 'integer' },
                  createdAt: { type: 'string' },
                  updatedAt: { type: 'string' },
                  agents: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        id: { type: 'string' },
                        name: { type: 'string' },
                        avatar: { type: 'string', nullable: true },
                        avatarColor: { type: 'string', nullable: true },
                        description: { type: 'string', nullable: true },
                        isActive: { type: 'boolean' },
                      },
                    },
                  },
                },
              },
            },
          },
          404: {
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              error: { type: 'string' },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const { id } = request.params;
      const category = await categoryService.findById(id);

      if (!category) {
        return reply.code(404).send({ success: false, error: '分类不存在' });
      }

      return reply.send({ success: true, data: category });
    }
  );

  // 创建分类
  app.post<{ Body: CreateCategoryBody }>(
    '/categories',
    {
      schema: {
        description: '创建新的助手分类',
        tags: ['Categories'],
        body: createCategoryBodySchema,
        response: {
          201: {
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              data: categoryResponseSchema,
            },
          },
          409: {
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              error: { type: 'string' },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const { name, description, sortOrder } = request.body;

      try {
        const category = await categoryService.create({
          name,
          description,
          sortOrder,
        });
        return reply.code(201).send({ success: true, data: category });
      } catch (error: any) {
        if (error.code === 'P2002') {
          return reply
            .code(409)
            .send({ success: false, error: '分类名称已存在' });
        }
        throw error;
      }
    }
  );

  // 更新分类
  app.put<{ Params: CategoryParams; Body: UpdateCategoryBody }>(
    '/categories/:id',
    {
      schema: {
        description: '更新分类信息',
        tags: ['Categories'],
        params: {
          type: 'object',
          properties: { id: { type: 'string' } },
        },
        body: updateCategoryBodySchema,
        response: {
          200: {
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              data: categoryResponseSchema,
            },
          },
          404: {
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              error: { type: 'string' },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const { id } = request.params;
      const data = request.body;

      try {
        const category = await categoryService.update(id, data);
        return reply.send({ success: true, data: category });
      } catch (error: any) {
        if (error.code === 'P2025') {
          return reply
            .code(404)
            .send({ success: false, error: '分类不存在' });
        }
        throw error;
      }
    }
  );

  // 删除分类
  app.delete<{ Params: CategoryParams }>(
    '/categories/:id',
    {
      schema: {
        description: '删除分类（分类下的助手会一并删除）',
        tags: ['Categories'],
        params: {
          type: 'object',
          properties: { id: { type: 'string' } },
        },
        response: {
          200: {
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              data: {
                type: 'object',
                properties: {
                  id: { type: 'string' },
                  name: { type: 'string' },
                  description: { type: 'string', nullable: true },
                  sortOrder: { type: 'integer' },
                  createdAt: { type: 'string' },
                  updatedAt: { type: 'string' },
                  deletedAgentsCount: { type: 'integer' },
                },
              },
            },
          },
          404: {
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              error: { type: 'string' },
            },
          },
          400: {
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              error: { type: 'string' },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const { id } = request.params;

      // 检查是否为系统分类
      if (id === 'system-category-00000000-0000-0000-0000-000000000001') {
        return reply.code(400).send({ success: false, error: '系统分类不允许删除' });
      }

      try {
        const category = await categoryService.delete(id);
        return reply.send({ success: true, data: category });
      } catch (error: any) {
        if (error.code === 'P2025') {
          return reply
            .code(404)
            .send({ success: false, error: '分类不存在' });
        }
        throw error;
      }
    }
  );
}