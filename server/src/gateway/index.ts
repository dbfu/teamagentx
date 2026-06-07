import { FastifyInstance } from 'fastify';

export type Gateway = (app: FastifyInstance) => Promise<void> | void;

export async function registerGateways(app: FastifyInstance, gateways: Gateway[]) {
  for (const gateway of gateways) {
    await gateway(app);
  }
}