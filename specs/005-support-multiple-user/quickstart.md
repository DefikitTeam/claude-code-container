# Quickstart: Verifying multi-registration support

1. **Deploy updated worker locally**
   - Run `npm run dev` with updated Durable Object bindings.

2. **Register first project**
   - `curl -X POST http://localhost:8787/register-user -H "Content-Type: application/json" -d '{"installationId":"123456","anthropicApiKey":"sk-ant-1","projectLabel":"Project One"}'`
   - Expect `201` response containing `userId="user_first"`.

3. **Register second project with same installation**
   - Repeat POST with `projectLabel":"Project Two"` and different API key.
   - Expect `201` response with new `userId` and `existingRegistrations` array listing prior entry.

4. **List repositories with disambiguation**
   - `curl "http://localhost:8787/github/repositories?installationId=123456&userId=user_first"`
   - Should return repository list for the first registration.

5. **List repositories without disambiguation**
   - `curl "http://localhost:8787/github/repositories?installationId=123456"`
   - Expect `409 Conflict` with guidance listing both `userId` values.

6. **Remove one registration**
   - `curl -X DELETE "http://localhost:8787/user-config/user_first"`
   - Confirm directory entry now references only the remaining registration.

7. **Run test suite**
   - Execute `npm test` to validate new unit and integration coverage for multi-registration flows.
