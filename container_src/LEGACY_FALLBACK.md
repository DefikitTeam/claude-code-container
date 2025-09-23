# Legacy Claude Code Fallback Flow

This project now includes a legacy fallback execution path for Claude Code
prompt processing, derived from the earlier REST-based container implementation
(`main.ts` on `main` branch). It is provided to mitigate failures in the new
ACP-integrated flow where the Claude Code process was exiting with code `1`
before streaming any messages.

## When It Runs

The legacy flow is activated in either of these scenarios:

1. Forced explicitly via environment variable:
   - `CLAUDE_LEGACY_FALLBACK=1` or `true` → Always use legacy path
   - `CLAUDE_LEGACY_FALLBACK=auto` → Attempt new flow first; on error, fallback
2. Automatic fallback during `processPromptWithClaudeCode` when an error occurs
   and the env var is set to `auto`/`true`/`1`.

## How It Works

File: `container_src/src/legacy-query.ts` Export: `runLegacyClaudeFlow(options)`

Key responsibilities:

- Accept a prompt + optional `workspacePath` and `apiKey`
- Prepare minimal environment (API key, debug logging)
- Execute `query()` from `@anthropic-ai/claude-code` directly
- Collect all streamed messages (no Git/PR side-effects)
- Provide optional diagnostics (env, auth file presence, CLI versions)
- Enforce a soft timeout (default 120s) to avoid hanging container

## Integration Points

In `acp-handlers.ts` inside `processPromptWithClaudeCode`:

- Early branch: if `CLAUDE_LEGACY_FALLBACK` is truthy (`1`/`true`) → run legacy
  immediately
- Error path: if modern flow throws and env is `auto|true|1` → attempt legacy
  before returning error

## Return Semantics

Legacy result maps to ACP response:

- On success: `stopReason=completed`, `summary` from last message content
- On failure: returns `stopReason=error` with diagnostic summary

## Environment Variables

| Variable                 | Purpose                                            |
| ------------------------ | -------------------------------------------------- | ---- | ------ |
| `CLAUDE_LEGACY_FALLBACK` | Control fallback mode (`1                          | true | auto`) |
| `CLAUDE_CODE_MODEL`      | Optional model hint passed to legacy + modern flow |
| `ANTHROPIC_API_KEY`      | Required for real (non-mock) execution             |

## Diagnostics

When `collectDiagnostics` is enabled (always for fallback inside handler):

- Node version
- CWD
- Presence of auth files (`~/.config/claude-code/auth.json`, `~/.claude.json`)
- Git version (if available)
- Claude CLI version (if available)
- Error message/stack if failure

## Rationale

The legacy REST implementation previously demonstrated stable behavior invoking
`query()` directly without the more complex ACP session abstraction. Introducing
this fallback allows continued iteration while deeper root-cause analysis
proceeds on the newer flow (suspected early CLI process exit / environment
initialization issue).

## Usage Examples

Force legacy for all prompts:

```
export CLAUDE_LEGACY_FALLBACK=1
```

Enable automatic fallback (prefer new flow, fallback on failure):

```
export CLAUDE_LEGACY_FALLBACK=auto
```

Specify model:

```
export CLAUDE_CODE_MODEL=claude-3-5-sonnet-20240620
```

## Next Steps / Improvements (Optional)

- Propagate token usage metrics from legacy path (currently approximated by
  message count)
- Stream partial progress notifications during legacy iteration
- Share unified diagnostics object across both flows
- Add test harness to simulate failure of modern path and validate fallback
  engagement

---

Feel free to adjust the fallback mode strategy once the root cause of the modern
flow exit is resolved.
