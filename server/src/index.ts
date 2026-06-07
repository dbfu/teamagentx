/**
 * 开发模式入口
 * 包含 Swagger API 文档功能
 */
import { createApp } from './app.js';
import { config } from './config/index.js';
import { registerSwagger } from './swagger-setup.js';

async function startDevServer() {
  const { app } = await createApp({ enableSwagger: true });

  // 注册 Swagger API 文档
  await registerSwagger(app, config.server.port);

  await app.listen({ port: config.server.port, host: config.server.host });
  console.log(`Server running on http://${config.server.host}:${config.server.port}`);
  console.log(`Swagger docs available at http://localhost:${config.server.port}/docs`);
}

startDevServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});