# LLM 配置

## 概述

LLM 配置定义智能体使用的语言模型设置，存储在数据库的 `LlmProvider` 表中。

## 创建 LLM 配置

1. 进入「LLM 配置」管理页面
2. 点击「创建配置」
3. 配置信息：

   - **名称**: 配置名称
   - **协议**: Anthropic 或 OpenAI
   - **API Endpoint**: API 地址
   - **API Key**: API 密钥
   - **模型**: 模型名称

4. 保存配置

## 协议类型

### Anthropic 协议

适用于 Claude 系列模型：

- API Endpoint: `https://api.anthropic.com`
- 模型示例: `claude-sonnet-4-6`, `claude-opus-4-7`

配置变量：
- `ANTHROPIC_API_KEY`
- `ANTHROPIC_MODEL`

### OpenAI 协议

适用于 OpenAI 或兼容的服务：

- API Endpoint: `https://api.openai.com/v1`
- 模型示例: `gpt-4`, `gpt-4o`

配置变量：
- `OPENAI_API_KEY`
- `OPENAI_MODEL`

## 自定义 Endpoint

可以配置自定义 API endpoint，支持：

- 本地模型服务
- 自建 API 网关
- 其他兼容服务

## 使用 LLM 配置

创建智能体时，可以选择已配置的 LLM：

1. 创建智能体
2. 在「LLM 配置」中选择配置
3. 智能体将使用该配置的模型

## 配置管理

### 编辑配置

修改配置信息，如更新 API 密钥或模型。

### 删除配置

删除不再使用的配置。注意：正在被智能体使用的配置无法删除。

## 安全建议

- 使用环境变量存储 API 密钥
- 不要在代码中硬编码密钥
- 定期更换 API 密钥
- 监控 API 使用情况