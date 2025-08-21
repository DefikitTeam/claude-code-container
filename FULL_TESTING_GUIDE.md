# 🚀 Claude Code Containers - Hướng Dẫn Test Đầy Đủ

## 🎯 Tổng quan khả năng của Container

### Container Claude Code này làm được:

1. **🔍 Phân tích Issue tự động**
   - Nhận webhook từ GitHub khi có issue mới  
   - Sử dụng Claude Code SDK để hiểu context và phân tích vấn đề
   - Parse nội dung issue và liên kết với codebase

2. **🛠 Sinh code và fix lỗi thông minh**
   - Clone repository về workspace tạm (`/tmp/workspaces/{uuid}`)
   - Dùng AI để sinh ra giải pháp/code fixes cụ thể
   - Tự động detect thay đổi trong files qua git status

3. **🚀 Tạo Pull Request hoàn toàn tự động**
   - Tạo feature branch (`claude-fix-issue-{number}`)
   - Commit changes với message chuẩn format
   - Push lên GitHub và tạo PR với description chi tiết
   - Auto-link PR với issue gốc

4. **🔐 Quản lý bảo mật enterprise-level**
   - Encrypt tất cả GitHub credentials bằng AES-256-GCM
   - Tự động refresh installation tokens
   - Verify webhook signatures để đảm bảo security

---

## 📋 Prerequisites

- **Node.js 22+** 
- **Cloudflare Account** với Workers & Containers enabled
- **Anthropic API Key** cho Claude Code
- **GitHub Account** để tạo GitHub App

---

## 🔧 Bước 1: Chuẩn bị môi trường

### 1.1 Clone và cài đặt dependencies

```bash
# Clone repository (nếu chưa có)
git clone <your-repo-url>
cd claudecode-modern-container

# Install Worker dependencies
npm install

# Install Container dependencies
cd container_src
npm install
npm run build  # Verify TypeScript compilation
cd ..
```

### 1.2 Tạo file environment variables

Tạo `.dev.vars` trong root directory:

```bash
# .dev.vars (git-ignored)
ANTHROPIC_API_KEY=sk-ant-api03-your-actual-key-here
```

---

## 🐙 Bước 2: Tạo và cấu hình GitHub App

### 2.1 Tạo GitHub App

1. **Truy cập:** https://github.com/settings/apps/new

2. **Cấu hình cơ bản:**
   ```
   GitHub App name: Claude Code Test Bot
   Description: Automated issue processing with AI
   Homepage URL: https://your-worker.your-subdomain.workers.dev
   ```

3. **Webhook Configuration:**
   ```
   Webhook URL: https://your-worker.your-subdomain.workers.dev/webhook/github
   Webhook secret: tạo random string 32 ký tự
   ```

4. **Permissions cần thiết:**
   ```
   Repository permissions:
   ✅ Issues: Read & Write
   ✅ Pull requests: Read & Write  
   ✅ Contents: Read & Write
   ✅ Metadata: Read
   
   Subscribe to events:
   ✅ Issues
   ```

5. **Lưu thông tin quan trọng:**
   - App ID
   - Client ID  
   - Private Key (download file .pem)
   - Webhook Secret
   - Installation ID (sau khi install app)

### 2.2 Install GitHub App vào repository test

1. Sau khi tạo app, click "Install App"
2. Chọn repository để test (có thể tạo repo test riêng)
3. Lưu **Installation ID** từ URL (dạng: `/settings/installations/{ID}`)

---

## 🚀 Bước 3: Development Setup

### 3.1 Start development server

```bash
# Terminal 1: Start Worker với Container
npm run dev
```

Server sẽ chạy tại: http://localhost:8787

### 3.2 Verify server status

```bash
curl http://localhost:8787/health
```

Response mong muốn:
```json
{
  "status": "healthy",
  "timestamp": "2025-08-20T...",
  "services": {
    "containers": "available",
    "durableObjects": "available", 
    "webhooks": "ready"
  }
}
```

---

## 🔐 Bước 4: Cấu hình GitHub App Credentials

### 4.1 Store encrypted credentials

```bash
curl -X POST http://localhost:8787/config \
  -H "Content-Type: application/json" \
  -d '{
    "appId": "YOUR_APP_ID",
    "privateKey": "-----BEGIN RSA PRIVATE KEY-----\nYOUR_PRIVATE_KEY_CONTENT\n-----END RSA PRIVATE KEY-----",
    "webhookSecret": "your_webhook_secret_32_chars",
    "installationId": "YOUR_INSTALLATION_ID"
  }'
```

Response thành công:
```json
{
  "message": "Configuration stored successfully",
  "timestamp": "..."
}
```

### 4.2 Verify credentials

```bash
curl http://localhost:8787/config
```

---

## 🧪 Bước 5: Test Cases Đầy Đủ

### Test Case 1: Basic Issue Processing

**Mục tiêu:** Kiểm tra workflow cơ bản từ issue → analysis → PR

**Setup:**
1. Tạo issue mới trong repo test:
   ```markdown
   Title: Fix typo in README.md
   Body: There's a spelling mistake in the README file. Please fix "recieve" to "receive" on line 15.
   ```

**Expected Result:**
- Container nhận webhook
- Clone repository
- Claude Code phân tích issue
- Tạo PR với fix

**Verification:**
```bash
# Check container logs
curl http://localhost:8787/container/logs/[container-id]
```

### Test Case 2: Complex Code Issue

**Mục tiêu:** Test khả năng xử lý issue phức tạp cần code changes

**Setup:**
1. Tạo issue:
   ```markdown
   Title: Add error handling to API endpoint
   Body: The /api/users endpoint doesn't handle invalid user IDs properly. 
   It should return 404 with proper error message instead of crashing.
   ```

**Expected Result:**
- Claude Code hiểu context API
- Sinh code với try-catch
- Tạo PR với proper error handling

### Test Case 3: Security Test

**Mục tiêu:** Verify webhook signature validation

**Setup:**
```bash
# Test với signature sai
curl -X POST http://localhost:8787/webhook/github \
  -H "Content-Type: application/json" \
  -H "X-GitHub-Event: issues" \
  -H "X-Hub-Signature-256: sha256=invalid_signature" \
  -d '{"action":"opened","issue":{"number":1}}'
```

**Expected Result:**
- Response 401 Unauthorized
- Security log ghi lại attempt

### Test Case 4: Container Resource Management

**Mục tiêu:** Test container lifecycle và cleanup

**Setup:**
1. Gửi nhiều requests đồng thời
2. Monitor container instances

**Verification:**
```bash
# Check container status
curl http://localhost:8787/container/status
```

### Test Case 5: Error Handling

**Mục tiêu:** Test graceful degradation

**Test scenarios:**
- Invalid repository URL
- Claude Code API timeout  
- GitHub API rate limit
- Network issues

---

## 📊 Monitoring và Debugging

### Development Logs

```bash
# Worker logs
wrangler tail

# Container logs  
curl http://localhost:8787/container/logs/[id]

# Health check với details
curl http://localhost:8787/health
```

### Production Deployment

```bash
# Deploy to Cloudflare
npm run deploy

# Set production environment variables
wrangler secret put ANTHROPIC_API_KEY
```

### Update webhook URL cho production

Update GitHub App webhook URL thành production URL:
`https://your-worker.your-subdomain.workers.dev/webhook/github`

---

## 🎯 Success Criteria

### ✅ Container hoạt động đúng khi:

1. **Webhook Processing:**
   - Nhận và validate GitHub webhooks
   - Parse issue data correctly
   - Trigger container processing

2. **AI Analysis:**
   - Claude Code SDK khởi tạo thành công
   - Phân tích issue content chính xác
   - Sinh ra solution hợp lý

3. **Git Operations:**
   - Clone repository thành công
   - Create feature branch
   - Commit và push changes

4. **GitHub Integration:**
   - Tạo PR với title/body phù hợp
   - Link PR với issue gốc
   - Proper formatting và metadata

5. **Security & Performance:**
   - Credentials được encrypt
   - Webhook signatures verified
   - Container cleanup sau processing
   - Error handling graceful

---

## 🚨 Troubleshooting

### Common Issues:

**1. Container không start:**
```bash
# Check Docker và Container runtime
docker --version
cd container_src && npm run build
```

**2. Claude Code API errors:**
```bash
# Verify API key
echo $ANTHROPIC_API_KEY | wc -c  # Should be ~60+ chars
```

**3. GitHub webhook không hoạt động:**
- Check webhook URL có public accessible không
- Verify webhook secret match
- Test với ngrok nếu local development

**4. Permission errors:**
- Verify GitHub App permissions
- Check installation trên đúng repository
- Confirm installation ID

---

## 📈 Performance Metrics

### Thời gian xử lý mong muốn:
- Webhook → Container: < 2 seconds
- Issue Analysis: < 30 seconds  
- Code Generation: < 60 seconds
- PR Creation: < 10 seconds

### Resource limits:
- Container timeout: 45 seconds
- Memory limit: 512MB
- Concurrent containers: 10

---

## 🔄 Next Steps

Sau khi test thành công, bạn có thể:

1. **Scale up:** Deploy multiple workers
2. **Customize:** Modify prompts cho specific use cases  
3. **Integrate:** Add support cho languages khác
4. **Monitor:** Setup alerting và metrics
5. **Extend:** Add comment processing, code review features

---

**🎉 Container này có thể xử lý hàng trăm GitHub issues tự động mỗi ngày, tiết kiệm hàng giờ công sức manual processing!**
