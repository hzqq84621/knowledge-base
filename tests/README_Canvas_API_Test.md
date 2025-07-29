# Canvas对话系统API测试说明

## 概述

本项目提供了一个完整的Canvas（Agent）对话系统API测试脚本，用于验证基于API Key的Canvas权限控制、对话功能和会话管理。

## 最新状态（2024-12-19）

**已完成Canvas API体系的完整分析和测试**，主要发现：

1. **API体系结构**：RAGFlow存在两套并行的API体系
   - **标准RESTful API**（`/api/v1/agents/{id}/sessions`）- 支持API Key认证，适合SDK调用
   - **Canvas Web API**（`/api/v1/canvas/*`）- 支持Session认证，功能更丰富但不支持API Key

2. **测试验证结果**：
   - ✅ API Key权限控制和Canvas列表获取
   - ✅ Agent会话创建和对话功能  
   - ✅ 会话删除功能（DELETE接口）
   - ❌ 会话重命名功能（PUT接口不存在）
   - ❌ Canvas Web API无法用API Key访问

3. **核心文件**：
   - `test_canvas_complete.py` - **统一测试脚本**（推荐使用）
   - `Canvas_API_Status_Analysis.md` - 完整的API现状分析报告

## 文件说明

### 核心测试脚本

**`tests/test_canvas_complete.py`** - 统一的Canvas测试脚本
- 支持4种测试模式：`list`、`interactive`、`auto`、`session`
- 包含完整的Canvas对话功能和会话管理测试
- 集成了所有测试功能，无需维护多个脚本

### 后端API接口

- **`api/apps/canvas_app.py`** - Canvas Web端接口（Session认证）
  - Canvas对话管理和页面渲染接口
  - 会话创建、列表、删除等Canvas特有功能

- **`api/apps/sdk/agent.py`** - SDK专用接口（API Key认证）
  - `/api/v1/canvas` - Canvas列表接口
  - `/api/v1/agents` - Agent列表接口

- **`api/apps/sdk/session.py`** - 标准RESTful会话接口（API Key认证）
  - `/api/v1/agents/<agent_id>/sessions` - 会话管理
  - `/api/v1/agents/<agent_id>/completions` - 对话接口

## 使用方法

### 基本使用

所有功能通过统一脚本`test_canvas_complete.py`提供：

#### 1. 列表模式（list）
```bash
python3 tests/test_canvas_complete.py --mode list
```
功能：列出API Key对应账户下的所有Canvas，包括类型统计

#### 2. 交互模式（interactive）
```bash
python3 tests/test_canvas_complete.py --mode interactive
```
功能：
1. 列出可用的Canvas
2. 用户选择要对话的Canvas
3. 创建会话并进行实时对话
4. 输入'exit'或'quit'退出对话

#### 3. 自动测试模式（auto）
```bash
python3 tests/test_canvas_complete.py --mode auto
```
功能：
1. 自动获取可用Canvas列表
2. 对前2个Canvas进行自动化对话测试
3. 使用预设测试消息验证对话功能

#### 4. 会话管理测试（session）
```bash
python3 tests/test_canvas_complete.py --mode session
```
功能：
1. 完整的会话生命周期测试（创建→对话→删除）
2. 验证会话管理API的功能完整性
3. 提供详细的测试报告和分析

### 高级配置

#### 指定服务器地址
```bash
python3 tests/test_canvas_complete.py --base-url http://localhost:9380 --mode interactive
```

#### 指定API Key
```bash
python3 tests/test_canvas_complete.py --api-token ragflow-xxxxxxxxxxxxxxxxxxxxxx --mode session
```

### API Key获取

运行脚本时，会提示输入API Token：
```
请输入API Token: ragflow-xxxxxxxxxxxxxxxxxxxxxx
```

## 测试功能总览

| 测试模式 | 功能描述 | 适用场景 |
|----------|----------|----------|
| `list` | Canvas列表获取和展示 | 快速验证API Key权限 |
| `interactive` | 交互式对话测试 | 手动测试特定Canvas的对话功能 |
| `auto` | 自动化对话测试 | 批量验证多个Canvas的基本功能 |
| `session` | 会话管理完整测试 | 验证会话生命周期和API一致性 |

## API接口详情

### 1. Canvas列表接口

**接口**: `GET /api/v1/canvas`

**认证**: Bearer Token (API Key)

**参数**:
- `page`: 页码（默认：1）
- `page_size`: 每页数量（默认：100）  
- `orderby`: 排序字段（默认：update_time）
- `desc`: 是否降序（默认：true）

**响应示例**:
```json
{
  "code": 0,
  "data": [
    {
      "id": "canvas_id",
      "title": "Canvas标题",
      "description": "Canvas描述",
      "is_virtual": true,
      "create_date": "创建时间",
      "update_date": "更新时间"
    }
  ],
  "message": "success"
}
```

### 2. 创建会话接口

**接口**: `POST /api/v1/agents/{agent_id}/sessions`

**认证**: Bearer Token (API Key)

**请求体**: `{}`（空JSON对象）

**响应示例**:
```json
{
  "code": 0,
  "data": {
    "id": "session_id",
    "agent_id": "agent_id",
    "message": [
      {
        "role": "assistant",
        "content": "欢迎消息"
      }
    ]
  }
}
```

### 3. 发送消息接口

**接口**: `POST /api/v1/agents/{agent_id}/completions`

**认证**: Bearer Token (API Key)

**请求体**:
```json
{
  "session_id": "会话ID",
  "question": "用户消息",
  "stream": false
}
```

**响应示例**:
```json
{
  "code": 0,
  "data": {
    "answer": "Agent回复内容",
    "session_id": "session_id",
    "reference": {}
  }
}
```

## 权限控制机制

### 1. API Key校验流程

1. **Token提取**: 从`Authorization: Bearer <token>`头中提取token
2. **数据库校验**: 查询`APIToken`表验证token有效性
3. **租户注入**: 将token对应的`tenant_id`注入到接口参数
4. **权限过滤**: 只返回该租户下可访问的Canvas

### 2. Canvas类型过滤

- **is_virtual=true**: 真正的Canvas/Agent，支持对话功能
- **is_virtual=false**: 普通对话记录，不支持新建对话

测试脚本会自动过滤出`is_virtual=true`的Canvas用于对话测试。

## 测试结果解析

### 1. 成功示例

```
✅ 服务器正常运行 (状态码: 200)
✅ 成功获取 4 个Canvas
📊 统计信息:
   - 总Canvas数: 4
   - 真正的Agent/Canvas数: 2
   - 对话数: 2
🤖 Agent回复: 你好！有什么可以帮您？
📊 自动化测试总结: 2/2 个Canvas测试成功
```

### 2. 错误处理

脚本包含完整的错误处理机制：
- 网络连接错误
- API认证失败
- Canvas不存在
- 会话创建失败
- 消息发送失败

## 开发说明

### 代码结构

```
tests/
└── test_canvas_complete.py         # 统一测试脚本（推荐使用）

api/apps/
├── canvas_app.py                   # Canvas Web端API
└── sdk/
    ├── agent.py                    # Canvas相关SDK API
    └── session.py                  # 对话相关SDK API
```

### 核心类

**CanvasCompleteTester**: 主要测试类
- `list_canvas()`: 获取Canvas列表
- `create_agent_session()`: 创建会话
- `send_message_to_agent()`: 发送消息
- `interactive_chat()`: 交互式对话
- `auto_test_chat()`: 自动化测试
- `session_management_test()`: 会话管理测试

### 扩展建议

1. **流式响应支持**: 可添加对流式对话的支持
2. **并发测试**: 添加多会话并发测试
3. **性能基准**: 添加响应时间和吞吐量测试
4. **文件上传**: 支持需要文件参数的Canvas测试

## 注意事项

1. **API Key安全**: 避免在代码中硬编码API Key
2. **测试环境**: 确保测试环境服务正常运行
3. **网络连接**: 确保网络连接正常，API请求超时设置为30秒
4. **权限范围**: API Key只能访问对应租户下的Canvas
5. **Canvas状态**: 只有`is_virtual=true`的Canvas支持对话功能

## 故障排除

### 1. 认证失败
- 检查API Key是否正确
- 确认API Key是否已过期
- 验证服务器地址是否正确

### 2. 无法获取Canvas
- 确认账户下是否有Canvas
- 检查Canvas的`is_virtual`状态
- 验证API权限配置

### 3. 对话失败
- 确认Canvas配置是否正确
- 检查LLM模型是否可用
- 验证知识库配置

## 更新日志

- **v2.0** (2024-12-19): 主要重构，统一测试脚本
  - 合并所有测试功能到`test_canvas_complete.py`
  - 完成API体系完整分析和验证
  - 支持4种测试模式：list/interactive/auto/session
  - 验证会话管理API的功能完整性
  - 清理无关文件，简化维护成本

- **v1.0** (2024-07-29): 初始版本
  - 完成API Key权限校验机制梳理
  - 实现基本的Canvas列表和对话功能
  - 支持交互式和自动化测试模式
