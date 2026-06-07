import prisma from '../../lib/prisma.js';

// Note: User creation is now handled through auth.service.ts
// This service is kept for read/update operations only

export const userService = {
  // Find user by socket ID
  async findBySocketId(socketId: string) {
    return prisma.user.findUnique({
      where: { socketId },
    });
  },

  // Find user by client ID
  async findByClientId(clientId: string) {
    return prisma.user.findUnique({
      where: { clientId },
    });
  },

  // Find user by ID
  async findById(id: string) {
    return prisma.user.findUnique({
      where: { id },
    });
  },

  // Delete user by socket ID (deprecated - should use ID instead)
  async delete(socketId: string) {
    return prisma.user.delete({
      where: { socketId },
    });
  },

  // Clear socket ID when user disconnects
  async clearSocket(socketId: string) {
    const user = await prisma.user.findUnique({
      where: { socketId },
    });
    if (user) {
      return prisma.user.update({
        where: { id: user.id },
        data: { socketId: null },
      });
    }
    return null;
  },
};