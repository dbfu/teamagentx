import prisma from '../../lib/prisma.js';
import { AgentCategory } from '@prisma/client';
import { randomUUID } from 'crypto';

export type CreateCategoryInput = {
  name: string;
  description?: string;
  sortOrder?: number;
};

export type UpdateCategoryInput = Partial<CreateCategoryInput>;

export const categoryService = {
  async create(data: CreateCategoryInput): Promise<AgentCategory> {
    return prisma.agentCategory.create({
      data: {
        id: randomUUID(),
        name: data.name,
        description: data.description,
        sortOrder: data.sortOrder ?? 0,
      },
    });
  },

  async findAll(): Promise<AgentCategory[]> {
    return prisma.agentCategory.findMany({
      orderBy: { sortOrder: 'asc' },
      include: {
        _count: {
          select: { agents: true },
        },
      },
    });
  },

  async findById(id: string): Promise<AgentCategory | null> {
    return prisma.agentCategory.findUnique({
      where: { id },
      include: {
        agents: {
          orderBy: { createdAt: 'desc' },
        },
      },
    });
  },

  async findByName(name: string): Promise<AgentCategory | null> {
    return prisma.agentCategory.findUnique({
      where: { name },
    });
  },

  async update(id: string, data: UpdateCategoryInput): Promise<AgentCategory> {
    return prisma.agentCategory.update({
      where: { id },
      data: {
        ...data,
        updatedAt: new Date(),
      },
    });
  },

  async delete(id: string): Promise<AgentCategory & { deletedAgentsCount: number }> {
    // 先获取该分类下的助手数量
    const agentsCount = await prisma.agent.count({
      where: { categoryId: id },
    });

    // 删除该分类下的所有助手
    await prisma.agent.deleteMany({
      where: { categoryId: id },
    });

    // 删除分类
    const category = await prisma.agentCategory.delete({
      where: { id },
    });

    return { ...category, deletedAgentsCount: agentsCount };
  },

  async reorder(id: string, sortOrder: number): Promise<AgentCategory> {
    return prisma.agentCategory.update({
      where: { id },
      data: { sortOrder, updatedAt: new Date() },
    });
  },
};