# Claude Code Container MCP Server

## Tổng quan

Claude Code Container MCP Server là một MCP (Model Context Protocol) server được xây dựng để bọc hệ thống Claude Code Container hiện tại, cung cấp cho các AI agents khả năng tự động hóa GitHub thông qua các tools, resources và prompts được chuẩn hóa.

## Kiến trúc

```
AI Agent (Claude, v.v.) → MCP Client → MCP Server → Claude Code Container → GitHub
```

### Các thành phần chính:

- **MCP Server**: Cung cấp giao diện MCP chuẩn để tương tác với hệ thống
- **Claude Code Client**: Wrapper HTTP client cho các endpoint hiện tại  
- **Claude Code Container**: Hệ thống backend chính (Cloudflare Workers + Container)

## Tính năng

### Tools (Công cụ)
- **process-github-issue**: Xử lý GitHub issue tự động với tạo pull request
- **process-custom-prompt**: Xử lý prompt tuỳ chỉnh trên repository
- **analyze-repository**: Phân tích cấu trúc và insights của repository
- **health-check**: Kiểm tra trạng thái hệ thống

### Resources (Tài nguyên) 
- **server-status**: Trạng thái hiện tại của hệ thống (JSON)
- **system-info**: Thông tin về khả năng hệ thống (Markdown)
- **repository-analysis**: Phân tích động cho repositories (Template)

### Prompts (Mẫu prompt)
- **analyze-and-resolve-issue**: Prompt toàn diện cho phân tích và giải quyết issue
- **code-review-and-improve**: Prompt review code với đề xuất cải thiện
- **analyze-architecture**: Prompt phân tích kiến trúc repository

## Cài đặt và Cấu hình

### Prerequisites
- Node.js >= 18
- pnpm hoặc npm
- Hệ thống Claude Code Container đang chạy

### Cài đặt

```bash
cd mcp-server
pnpm install
```

### Cấu hình môi trường

Tạo file `.env`:
```bash
# URL của Claude Code Container API
CLAUDE_CODE_API_URL=http://localhost:8787

# Các biến môi trường khác nếu cần
```

### Build

```bash
pnpm build
```

## Sử dụng

### Chạy MCP Server

```bash
# Development mode
pnpm dev

# Production mode  
pnpm start
```

### Tích hợp với AI Clients

#### Claude Desktop
Thêm vào file cấu hình Claude Desktop (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "claude-code-container": {
      "command": "node",
      "args": ["/path/to/mcp-server/dist/index.js"],
      "env": {
        "CLAUDE_CODE_API_URL": "http://localhost:8787"
      }
    }
  }
}
```

#### Cline VSCode Extension
Thêm vào cấu hình MCP servers:

```json
{
  "name": "claude-code-container",
  "command": "node",
  "args": ["/path/to/mcp-server/dist/index.js"],
  "env": {
    "CLAUDE_CODE_API_URL": "http://localhost:8787"  
  }
}
```

#### Custom MCP Client
```typescript
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const transport = new StdioClientTransport({
  command: "node",
  args: ["/path/to/mcp-server/dist/index.js"]
});

const client = new Client({
  name: "my-app",
  version: "1.0.0"
});

await client.connect(transport);

// Sử dụng tools
const result = await client.callTool({
  name: "process-github-issue", 
  arguments: {
    repository: "owner/repo",
    issueNumber: 123
  }
});

// Truy cập resources
const resource = await client.readResource({
  uri: "status://server"
});

// Sử dụng prompts
const prompt = await client.getPrompt({
  name: "analyze-and-resolve-issue",
  arguments: {
    repository: "owner/repo",
    issueNumber: 123,
    includeContext: true
  }
});
```

## API Reference

### Tools

#### process-github-issue
Xử lý GitHub issue tự động với AI và tạo pull request.

**Parameters:**
- `repository` (string): Repository GitHub định dạng 'owner/repo'
- `issueNumber` (number): Số issue cần xử lý
- `branch` (string, optional): Branch target (mặc định main/master)
- `title` (string, optional): Tiêu đề tuỳ chỉnh

**Returns:** Text với kết quả xử lý và link pull request (nếu có)

#### process-custom-prompt
Xử lý prompt tuỳ chỉnh trên repository.

**Parameters:**
- `prompt` (string): Prompt tuỳ chỉnh cần xử lý
- `repository` (string): Repository GitHub 
- `branch` (string, optional): Branch target
- `title` (string, optional): Tiêu đề tuỳ chỉnh

**Returns:** Text với kết quả xử lý

#### analyze-repository
Phân tích cấu trúc repository và cung cấp insights.

**Parameters:**
- `repository` (string): Repository GitHub
- `type` (string, optional): Loại phân tích ("detailed", "metrics")

**Returns:** Text với phân tích cấu trúc, metrics và recommendations

#### health-check
Kiểm tra trạng thái sức khoẻ của hệ thống.

**Parameters:** Không có

**Returns:** Text với trạng thái các services

### Resources

#### status://server
Trạng thái hiện tại của hệ thống ở định dạng JSON.

#### system://info  
Thông tin chi tiết về khả năng và kiến trúc hệ thống ở định dạng Markdown.

#### analysis://{repository}
Phân tích động cho repository cụ thể. Thay `{repository}` bằng owner/repo.

### Prompts

#### analyze-and-resolve-issue
Prompt toàn diện để phân tích và giải quyết GitHub issues.

**Arguments:**
- `repository` (string): Repository GitHub
- `issueNumber` (number): Số issue  
- `includeContext` (boolean, optional): Bao gồm context bổ sung

#### code-review-and-improve
Prompt review code toàn diện với đề xuất cải thiện.

**Arguments:**
- `repository` (string): Repository GitHub
- `pullRequestNumber` (number): Số pull request
- `codeSnippet` (string, optional): Code snippet cụ thể để focus

#### analyze-architecture
Prompt phân tích kiến trúc sâu của repository.

**Arguments:**
- `repository` (string): Repository GitHub
- `language` (string, optional): Ngôn ngữ chính để focus
- `framework` (string, optional): Framework/tech stack để phân tích

## Tích hợp vào Hệ thống Khác

### 1. Tích hợp với AI Chatbots

```python
# Example với Python MCP client
import asyncio
from mcp import Client, StdioServerParameters, stdio

async def use_claude_code_mcp():
    server_params = StdioServerParameters(
        command="node",
        args=["/path/to/mcp-server/dist/index.js"],
        env={"CLAUDE_CODE_API_URL": "http://localhost:8787"}
    )
    
    async with stdio(server_params) as (read, write):
        async with Client(read, write) as client:
            # Sử dụng tools
            result = await client.call_tool("process-github-issue", {
                "repository": "owner/repo", 
                "issueNumber": 123
            })
            print(result.content)

asyncio.run(use_claude_code_mcp())
```

### 2. Tích hợp với Web Applications

```javascript
// Express.js middleware để proxy MCP calls
const express = require('express');
const { Client } = require('@modelcontextprotocol/sdk/client');
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio');

const app = express();

app.post('/api/process-issue', async (req, res) => {
  const { repository, issueNumber } = req.body;
  
  const transport = new StdioClientTransport({
    command: 'node',
    args: ['/path/to/mcp-server/dist/index.js']
  });
  
  const client = new Client({ name: 'web-app', version: '1.0.0' });
  
  try {
    await client.connect(transport);
    
    const result = await client.callTool({
      name: 'process-github-issue',
      arguments: { repository, issueNumber }
    });
    
    res.json({ success: true, result });
  } catch (error) {
    res.json({ success: false, error: error.message });
  } finally {
    await client.close();
  }
});
```

### 3. Tích hợp với CI/CD Pipelines

```yaml
# GitHub Actions example
name: Auto Process Issues
on:
  issues:
    types: [opened, labeled]

jobs:
  process-issue:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      
      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '18'
          
      - name: Setup MCP Server
        run: |
          cd mcp-server
          npm install
          npm run build
          
      - name: Process Issue with Claude Code
        run: |
          node mcp-server/dist/index.js --tool=process-github-issue \
            --repository="${{ github.repository }}" \
            --issueNumber="${{ github.event.issue.number }}"
```

### 4. Tích hợp với Slack/Discord Bots

```javascript
// Slack Bot example
const { App } = require('@slack/bolt');
const { Client } = require('@modelcontextprotocol/sdk/client');

const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET
});

app.command('/process-issue', async ({ command, ack, respond }) => {
  await ack();
  
  const [repository, issueNumber] = command.text.split(' ');
  
  // Setup MCP client
  const transport = new StdioClientTransport({
    command: 'node',
    args: ['/path/to/mcp-server/dist/index.js']
  });
  
  const client = new Client({ name: 'slack-bot', version: '1.0.0' });
  
  try {
    await client.connect(transport);
    
    const result = await client.callTool({
      name: 'process-github-issue',
      arguments: { repository, issueNumber: parseInt(issueNumber) }
    });
    
    await respond({
      text: `Processed issue #${issueNumber} in ${repository}`,
      blocks: [
        {
          type: 'section',
          text: { type: 'mrkdwn', text: result.content[0].text }
        }
      ]
    });
  } catch (error) {
    await respond(`Error: ${error.message}`);
  } finally {
    await client.close();
  }
});
```

## Troubleshooting

### Common Issues

1. **Connection Failed**
   - Kiểm tra CLAUDE_CODE_API_URL trong .env
   - Đảm bảo hệ thống Claude Code Container đang chạy
   - Verify network connectivity

2. **TypeScript Compilation Errors**
   ```bash
   pnpm install
   pnpm build
   ```

3. **Runtime Errors**
   - Kiểm tra logs của MCP server
   - Verify input parameters cho tools/prompts
   - Check GitHub credentials configuration

### Debug Mode

```bash
# Chạy với debug logging
DEBUG=mcp:* pnpm start

# Hoặc set biến môi trường
export DEBUG=mcp:*
pnpm start
```

### Health Check

```bash
# Test MCP server connection
echo '{"jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": {"name": "health-check", "arguments": {}}}' | node dist/index.js
```

## Performance và Scaling

### Recommendations

1. **Production Deployment**
   - Sử dụng process manager (PM2, systemd)
   - Setup monitoring và logging
   - Configure proper resource limits

2. **Multiple Instances**
   - MCP server là stateless, có thể scale horizontal
   - Sử dụng load balancer nếu cần
   - Share configuration qua environment variables

3. **Caching**
   - Repository analysis results có thể cached
   - Implement TTL cho health status
   - Cache GitHub API responses khi thích hợp

## Security

### Best Practices

1. **Environment Variables**
   - Không hardcode credentials
   - Sử dụng secure secret management
   - Rotate GitHub tokens định kỳ

2. **Input Validation**
   - Server tự động validate inputs thông qua Zod schemas
   - Sanitize repository names và parameters
   - Rate limiting cho production use

3. **Network Security**
   - Run trong isolated network environment
   - Use HTTPS cho tất cả external communications
   - Monitor và log tất cả requests

## License

MIT License - xem file LICENSE để biết chi tiết.

## Support

Để được hỗ trợ:
1. Kiểm tra documentation này trước
2. Search trong GitHub issues 
3. Tạo issue mới với chi tiết logs và steps to reproduce
