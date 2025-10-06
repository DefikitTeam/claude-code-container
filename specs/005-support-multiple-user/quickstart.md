# Quickstart: Verifying multi-registration support

Use this runbook to confirm that multiple projects can share a single GitHub App installation without stepping on each other.

> All commands assume the worker is running locally on <http://localhost:8787>. Open a second terminal for the curl calls while `npm run dev` continues to stream logs.

## 1. Launch the worker with Durable Object bindings

```bash
npm run dev
```

You should see Wrangler report `Listening on http://127.0.0.1:8787` with the `UserConfigDO` binding resolved.

## 2. Register the first project for installation `123456`

```bash
curl -sS \
   -X POST http://localhost:8787/register-user \
   -H "Content-Type: application/json" \
   -d '{
      "installationId": "123456",
      "anthropicApiKey": "sk-ant-first",
      "projectLabel": "Project One"
   }' | jq
```

Expected response (userId will differ):

```json
{
   "success": true,
   "userId": "user_01hcd9svkmtk4",
   "installationId": "123456",
   "projectLabel": "Project One",
   "existingRegistrations": [],
   "message": "User registered successfully. You can now deploy your Worker with these credentials.",
   "nextSteps": { "step1": "Deploy your Cloudflare Worker with the provided userId and installationId", "step2": "Configure your wrangler.jsonc with the USER_CONFIG binding", "step3": "Set environment variables for ANTHROPIC_API_KEY", "step4": "Test your integration with a GitHub issue" }
}
```

Save the returned `userId` (example above: `user_01hcd9svkmtk4`) as `USER_FIRST` for later steps.

```bash
export USER_FIRST="user_01hcd9svkmtk4" # replace with the value from your response
```

## 3. Register a second project on the same installation

```bash
curl -sS \
   -X POST http://localhost:8787/register-user \
   -H "Content-Type: application/json" \
   -d '{
      "installationId": "123456",
      "anthropicApiKey": "sk-ant-second",
      "projectLabel": "Project Two"
   }' | jq
```

Example 201 response (note the `existingRegistrations` array):

```json
{
   "success": true,
   "userId": "user_01hcd9sz72qj2",
   "installationId": "123456",
   "projectLabel": "Project Two",
   "existingRegistrations": [
      {
         "userId": "user_01hcd9svkmtk4",
         "projectLabel": "Project One",
         "created": 1728238800000
      }
   ]
}
```

Save this second identifier as `USER_SECOND`.

```bash
export USER_SECOND="user_01hcd9sz72qj2" # replace with the value from your response
```

## 4. List repositories with explicit disambiguation

```bash
curl -sS \
   "http://localhost:8787/github/repositories?installationId=123456&userId=${USER_FIRST}" | jq '{success, count, sampleRepository: .repositories[0]}'
```

Sample response (fields trimmed for brevity):

```json
{
   "success": true,
   "count": 18,
   "sampleRepository": {
      "id": 1234567,
      "name": "example-repo",
      "private": false,
      "owner": "AcmeCo"
   }
}
```

No `registrations` metadata appears when the `userId` resolves unambiguously.

## 5. Observe the conflict guidance when `userId` is omitted

```bash
curl -sS "http://localhost:8787/github/repositories?installationId=123456" | jq
```

Expected 409 response:

```json
{
   "success": false,
   "error": "Multiple registrations found for installation. Provide userId to disambiguate.",
   "registrations": [
      { "userId": "user_01hcd9svkmtk4", "projectLabel": "Project One" },
      { "userId": "user_01hcd9sz72qj2", "projectLabel": "Project Two" }
   ]
}
```

## 6. Remove the first registration and verify cleanup

```bash
curl -sS -X DELETE "http://localhost:8787/user-config/${USER_FIRST}" | jq
```

Successful deletion returns:

```json
{
   "success": true,
   "message": "User configuration deleted successfully",
   "removedUserId": "user_01hcd9svkmtk4",
   "installationId": "123456",
   "remainingRegistrations": [
      { "userId": "user_01hcd9sz72qj2", "projectLabel": "Project Two" }
   ]
}
```

Re-run the repositories conflict check; it now succeeds with `USER_SECOND` and returns `404` if you request the deleted user.

```bash
curl -sS "http://localhost:8787/github/repositories?installationId=123456" | jq
curl -sS "http://localhost:8787/github/repositories?installationId=123456&userId=${USER_SECOND}" | jq '.success'
curl -sS "http://localhost:8787/user-config/${USER_FIRST}" | jq '.success, .error'
```

## 7. Run the full test suite for regression coverage

```bash
npm test
```

Vitest should report all suites passing, including `test/user-config/user-config-do.test.ts`, endpoint tests, and `test/integration/register-user-multi.test.ts`.
