# ACP Automation Notification Contract

## Toast Message
- **Purpose**: Immediate in-session alert when ACP automation is skipped, rolled back, or encounters critical errors.
- **Channel**: LumiLink-BE UI toast component.
- **Content Rules**:
  - Title: "Automation update" (localized later).
  - Body: concise explanation ≤140 characters (e.g., "GitHub automation skipped: repo is blocked for this workspace.").
  - Severity: `warning` for skips, `error` for rollbacks, `info` for recovery messages.
  - No secrets or repository tokens; may include repository name and session ID suffix.
  - Auto-dismiss after 10 seconds but remain accessible via transcript note.

## Transcript Note
- Stored alongside session timeline entries.
- Fields:
  - `timestamp` (ISO 8601, UTC)
  - `eventType` = `toast`
  - `summary` (matches toast body)
  - `details` (optional JSON payload with `skipReason`, `rollbackTrigger`, `issueUrl`, `prUrl`)
- Guarantees long-term auditability for compliance reviews.

## Alert Emission
- On automation skip:
  1. Emit toast (severity `warning`).
  2. Append transcript note with `skipReason` enum value.
  3. Log `[GITHUB-AUTO] skip` entry including repository and reason code.
- On auto rollback:
  1. Emit toast (severity `error`) referencing fallback to HTTP.
  2. Append transcript note with `rollbackTrigger = autoThreshold` and threshold metadata.
  3. Create `RollbackEvent` record linked to the active workspace.
- On recovery back to ACP:
  1. Emit toast (severity `info`) describing restoration.
  2. Transcript note marks `eventType = rollback` with `status = resolved`.

## Integration Points
- lumilink-be route `src/route/acp.ts`: attaches toast/transcript payload to session result envelope.
- Service `src/services/acp-bridge.service.ts`: populates skip/rollback metadata.
- Real-time: `src/services/websocket-notification.service.ts` + `NotificationWebSocketDO` broadcast toast payloads.
- Persistence: `src/services/user-notification.service.ts` persists a matching `UserNotification` record.
- LumiLink UI: renders toast immediately; adds transcript entry via existing session log feed API.
- Analytics pipeline: capture toast events via structured log ingestion for KPI reporting on skip frequency.

Severity mapping to existing enums:
- `warning` | `error` | `info` correspond to `type` in `UserNotification` and are compatible with current UI rendering.
