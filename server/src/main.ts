import { NestFactory, Reflector } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { TransformInterceptor } from './common/interceptors/transform.interceptor';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // 启用 CORS（允许前端跨域请求）
  app.enableCors();

  // 全局验证管道（配合 class-validator）
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
    }),
  );

  // 全局统一响应拦截器（需要 Reflector 来读取 @SkipTransform 元数据）
  app.useGlobalInterceptors(new TransformInterceptor(app.get(Reflector)));

  // 全局异常过滤器
  app.useGlobalFilters(new AllExceptionsFilter());

  // Swagger 文档配置
  const config = new DocumentBuilder()
    .setTitle('AI Agent Learn API')
    .setDescription('Phase 1~5: 基础聊天 → LangChain → LangGraph → RAG → Multi-Agent')
    .setVersion('5.0')
    .addTag('Chat - 聊天', '聊天相关接口（普通 + 流式）')
    .addTag('Agent - 智能助手', '带工具调用的智能助手接口（Tool Use）')
    .addTag('LangGraph - Agent 编排引擎 (Phase 3)', 'LangGraph Agent 编排')
    .addTag('RAG - 检索增强生成 (Phase 4)', 'RAG 检索增强生成')
    .addTag('Multi-Agent - 多 Agent 协作系统 (Phase 5)', '多 Agent 协作系统（Supervisor + Swarm）')
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api-docs', app, document);

  const port = process.env.PORT ?? 3000;
  await app.listen(port);
  console.log(`Server running on http://localhost:${port}`);
  console.log(`Swagger docs: http://localhost:${port}/api-docs`);
}
bootstrap();
