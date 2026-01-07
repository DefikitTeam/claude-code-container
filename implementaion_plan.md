# Kế hoạch Triển khai: Full Interactive Restoration (Code Mode)

Tài liệu này mô tả chi tiết kế hoạch kỹ thuật để hiện thực hóa tính năng "Khôi phục trạng thái toàn diện" cho Code Mode, trên 3 repository chính: Backend (Lumi BE), Frontend (Lumi FE), và Container Agent.

## Mục tiêu

Đạt được trải nghiệm "Zero-Latency Resume" khi container thức dậy:

1.  **Work State:** Khôi phục đúng ngữ cảnh làm việc (tabs, files, cursor).
2.  **Conversation Context:** Khôi phục trí nhớ ngắn hạn (raw history) và dài hạn (summary) cho Agent.

## Yêu cầu Review của User

> [!IMPORTANT]
> Cần xác nhận schema database cho `sessionMetadata`. JSON Blob là giải pháp linh hoạt nhất nhưng cần thống nhất structure để Type-safe ở code.

## Thay đổi Đề xuất

---

### 1. Repository: Backend (Lumi BE)

Trách nhiệm: Lưu trữ "Bộ não" và "Trạng thái".

#### Database Schema (Prisma)

- **[MODIFY] `schema.prisma`**:
  - Thêm field `sessionMetadata` (Json?) vào model `ChatSession`: Lưu Work State (file mở, terminal...).
  - Thêm field `contextSummary` (String?) vào model `ChatSession`: Lưu tóm tắt cuộc hội thoại cũ.
  - Thêm field `lastSummarizedMessageId` (Int?): Đánh dấu điểm mốc đã tóm tắt để job chạy tiếp.

#### API Endpoints

- **[NEW] `POST /api/coding-mode/sessions/:sessionId/state`**:
  - Frontend gọi API này (debounced 5s/lần) để lưu Work State hiện tại.
  - Body: `{ openFiles: [], activeFile: "", terminal: {} }`.
- **[MODIFY] `GET /api/coding-mode/sessions/:sessionId`**:
  - Trả về thêm `sessionMetadata` để Frontend khôi phục UI.

#### Logic & Services

- **[MODIFY] `messages.handler.ts` (hoặc Service tương ứng)**:
  - Khi lưu message mới, kiểm tra độ dài lịch sử. Nếu > 20 messages -> Trigger `SummarizationQueue`.
- **[NEW] `SummarizationService`**:
  - Job background (dùng Cloudflare Queues): Lấy N messages chưa tóm tắt -> Gọi LLM (nhỏ, rẻ) -> Tạo summary -> Update vào DB `ChatSession.contextSummary`.
- **[MODIFY] `ExecuteTaskUseCase.ts`**:
  - Khi chuẩn bị payload cho `AcpClient`:
    - Lấy `contextSummary` + 10-20 messages gần nhất.
    - Merge thành `fullContext` trong prompt gửi đi.
    - Lấy `sessionMetadata` gửi kèm trong field `workspaceState` của payload.

---

### 2. Repository: Frontend (Lumi FE)

Trách nhiệm: Thu thập và Khôi phục trạng thái UI.

#### State Management

- **[NEW] `useSessionState.ts` (Hook)**:
  - Theo dõi thay đổi của: List file đang mở (`openFiles`), File đang focus (`activeFile`), Vị trí scroll/cursor (nếu editor hỗ trợ).
  - Tự động gọi API `POST /state` khi có thay đổi (Debounce kỹ để không spam server).

#### UI Components

- **[MODIFY] `CodeModeInterface.tsx`**:
  - Khi init session (resume): Đọc `sessionMetadata` từ API response.
  - Tự động mở lại các file user đang làm dở.
  - Hiển thị indicator nhỏ: "All changes saved" (cloud icon).
- **[MODIFY] `ChatWindow.tsx`**:
  - Hiển thị nhẹ dòng thông báo: _"Previous conversation summarized"_ nếu có summary, giúp user hiểu tại sao chat log cũ bị ẩn (nếu muốn ẩn bớt).

---

### 3. Repository: Container Agent (ACP / Daytona Support)

Trách nhiệm: Thực thi lệnh khôi phục.

#### ACP Protocol Update

- **[MODIFY] `acp-agent.ts` (hoặc `agent.server.ts`)**:
  - Cập nhật handler `session/new` hoặc `session/load` để nhận thêm field: `resumeState` (chứa workspace state) và `initialContext` (chứa summary).
  - **Xử lý `resumeState`**:
    - Nếu có thông tin file đang mở -> Agent "giả vờ" mở file đó trong ngữ cảnh nội bộ (để các tool sau này ưu tiên file này).
    - Nếu có thông tin terminal cwd -> `cd` vào đúng thư mục đó.
  - **Xử lý `initialContext`**:
    - Inject `contextSummary` vào **System Prompt**: _"You are continuing a session where: [Summary]. Current goal: ..."_

## Kế hoạch Kiểm thử (Verification Plan)

### Automated Tests

- **BE Unit Test:** Test logic `SummarizationService` (input list messages -> output summary mock).
- **BE Integration Test:** Test API `POST /state` lưu và `GET` trả về đúng JSON.

### Manual Verification

1.  **Work State:**
    - Mở 3 file A, B, C.
    - Tắt tab trình duyệt.
    - Mở lại -> Thấy vẫn còn 3 file A, B, C.
2.  **Context:**
    - Chat 30 câu với agent.
    - Restart Container.
    - Hỏi câu thứ 31 refer lại câu số 1 -> Agent vẫn hiểu (nhờ summary).

## Flow Diagram (Minh họa)

Dưới đây là luồng hoạt động tổng thể của hệ thống "Full Interactive":

```mermaid
sequenceDiagram
    participant U as User (Frontend)
    participant B as Backend (Lumi)
    participant DB as Database (D1)
    participant L as LLM (Summarizer)
    participant C as Container (Daytona/Agent)

    Note over U, DB: 1. Continuous State Saving
    U->>U: Code, Open Tabs, Scroll...
    U->>B: POST /state (Debounced 5s)
    Note right of U: { openFiles, cursor, terminal }
    B->>DB: Update ChatSession.sessionMetadata

    Note over B, L: 2. Background Summarization
    B->>DB: Check Check History Length > 20?
    DB-->>B: Yes (30 msgs)
    B->>L: "Summarize first 10 msgs please"
    L-->>B: "User asked to setup Next.js..."
    B->>DB: Update ChatSession.contextSummary

    Note over U, C: 3. Session Resume / Wake Up
    U->>B: GET /session/:id
    B->>DB: Load Metadata & Summary
    DB-->>B: Return Data
    B-->>U: { openFiles: [...], status: "inactive" }
    U->>U: Restore UI Tabs & Cursor

    U->>B: "Wake up Container!"
    B->>C: Start Container (Mount Volume)
    C-->>B: Ready
    B->>C: Init Agent Session
    Note right of B: Payload: { gitBranch, summaryContext }
    C->>C: Apply System Prompt with Summary
    C-->>B: Session Active

    Note over U, C: 4. Seamless Continuation
    U->>C: "Tiếp tục công việc nãy nhé"
    C->>C: "Hiểu rồi, đang làm dở Next.js..."

## Chiến lược Thực hiện (Execution Strategy)

Các repo KHÔNG THỂ chạy hoàn toàn độc lập mà cần tuân theo thứ tự phụ thuộc (Dependencies) sau để tránh breaking changes:

### Phase 1: Foundation (Bắt buộc làm trước - Repo BE)
**Mục tiêu:** Chuẩn bị hạ tầng Database và API Contract.
1.  Frontend & Container *chưa cần làm gì*.
2.  Backend update `schema.prisma` -> Migrate DB.
3.  Backend dựng sẵn API endpoint `POST /state` (có thể nhận data nhưng chưa xử lý logic phức tạp).
4.  Backend update payload gửi đi cho ACP (có thêm field `metadata` null/empty).

### Phase 2: Parallel Execution (Có thể chạy song song)
Sau khi Phase 1 xong, team có thể tách ra làm 2 luồng:

**Luồng A: Frontend (Lumi FE)**
- Cài đặt hook `useSessionState`.
- Bắt sự kiện thay đổi file/cursor -> Gọi API Phase 1.
- Update UI khi load lại trang (đọc từ API Phase 1).

**Luồng B: Container Intelligence (Container Src)**
- Update `acp-agent.ts` để đón nhận field mới từ payload.
- Cài đặt logic "Fake Open File" và "Pre-load Context".
- Local Test: Mock payload để test behavior của agent.

### Phase 3: The "Brain" (Quay lại Repo BE)
**Mục tiêu:** Kích hoạt tính năng thông minh (Summarization).
- Backend cài đặt `SummarizationService`.
- Background Job chạy thực tế.
- Khớp nối (Integration): Dữ liệu từ FE gửi lên (Pha 2A) -> Được xử lý (Pha 3) -> Gửi xuống Container (Pha 2B).

**Tổng kết:**
- **Backend:** Làm đầu tiên (Framework) và cuối cùng (Logic).
- **FE & Container:** Làm ở giữa (Implementation).
```
