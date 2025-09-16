# T018-T020 Implementation Verification Guide

This guide provides step-by-step instructions to verify the successful implementation of T018 (Workspace Isolation), T019 (Full ACP Workflow Integration Tests), and T020 (Zed Editor Compatibility Tests).

## 🎯 Quick Start Verification

### Option 1: Automated Test Suite (Recommended)

```bash
# Run the comprehensive test suite
./test-t018-t020-complete.sh
```

**Expected Results:**
- ✅ All workspace isolation components working
- ✅ ACP workflow integration tests passing
- ✅ Zed compatibility tests verified
- ✅ Success rate ≥80% (critical threshold)

### Option 2: Manual Step-by-Step Verification

Follow the detailed steps below if you want to understand each component.

---

## 📋 Prerequisites

Before running any tests, ensure you have:

1. **Container Dependencies Installed**
   ```bash
   cd container_src
   pnpm install
   ```

2. **Container Built**
   ```bash
   cd container_src
   pnpm build
   ```

3. **Test Framework Ready**
   ```bash
   cd container_src
   pnpm vitest --version  # Should show vitest version
   ```

---

## 🏗️ T018: Workspace Isolation Verification

### What T018 Implements
- Filesystem-based workspace isolation
- Session management with isolated directories
- Git operations within workspaces
- File operations with security boundaries
- Workspace lifecycle management (create, load, cleanup)

### Verification Steps

1. **Check Implementation Files Exist**
   ```bash
   ls -la container_src/src/workspace-manager.ts
   ls -la container_src/src/types/workspace.ts
   ```

2. **Test TypeScript Compilation**
   ```bash
   cd container_src
   pnpm tsc --noEmit src/workspace-manager.ts
   ```

3. **Test Workspace Manager Loading**
   ```bash
   cd container_src
   node -e "const wm = require('./dist/workspace-manager'); console.log('✅ Workspace manager loaded successfully')"
   ```

4. **Test Integration with ACP Handlers**
   ```bash
   cd container_src
   grep -r "workspace-manager" src/handlers/ || echo "Integration may be in acp-server.ts"
   ```

### Expected Behaviors
- ✅ Workspaces created in isolated directories
- ✅ File operations confined to workspace boundaries
- ✅ Git operations work within workspaces
- ✅ Automatic cleanup after session timeout
- ✅ Security validation prevents path traversal

---

## 🔄 T019: Full ACP Workflow Integration Tests Verification

### What T019 Implements
- End-to-end ACP workflow testing
- stdio JSON-RPC communication tests
- Session lifecycle validation
- Multi-session isolation testing
- Concurrent operation handling

### Verification Steps

1. **Check Integration Test Exists**
   ```bash
   ls -la container_src/tests/integration/acp_workflow.test.ts
   ```

2. **Test Syntax and Dependencies**
   ```bash
   cd container_src
   pnpm tsc --noEmit tests/integration/acp_workflow.test.ts
   ```

3. **Run Full Workflow Integration Tests**
   ```bash
   cd container_src
   pnpm vitest tests/integration/acp_workflow.test.ts --reporter=verbose
   ```

4. **Test Individual Workflow Steps**
   ```bash
   cd container_src
   # Test specific scenarios
   pnpm vitest tests/integration/acp_workflow.test.ts -t "Complete ACP workflow"
   pnpm vitest tests/integration/acp_workflow.test.ts -t "Session isolation"
   pnpm vitest tests/integration/acp_workflow.test.ts -t "Concurrent operations"
   ```

### Expected Test Results
- ✅ **Initialize → Session/New → Session/Prompt workflow** passes
- ✅ **Session isolation** between multiple sessions works
- ✅ **Error handling** for invalid requests works
- ✅ **Concurrent operations** handled properly
- ✅ **Workspace file operations** integrated with sessions

---

## 🎯 T020: Zed Editor Compatibility Tests Verification

### What T020 Implements
- Zed editor configuration compatibility
- Agent manifest validation
- Protocol version compatibility testing
- stdio communication validation
- Activation pattern testing

### Verification Steps

1. **Check Zed Compatibility Test Exists**
   ```bash
   ls -la container_src/tests/integration/zed_compatibility.test.ts
   ```

2. **Test Syntax and Dependencies**
   ```bash
   cd container_src
   pnpm tsc --noEmit tests/integration/zed_compatibility.test.ts
   ```

3. **Run Zed Compatibility Tests**
   ```bash
   cd container_src
   pnpm vitest tests/integration/zed_compatibility.test.ts --reporter=verbose
   ```

4. **Test Agent Manifest Generation**
   ```bash
   cd container_src
   pnpm vitest tests/integration/zed_compatibility.test.ts -t "Agent manifest"
   ```

5. **Test stdio Communication**
   ```bash
   cd container_src
   pnpm vitest tests/integration/zed_compatibility.test.ts -t "stdio communication"
   ```

### Expected Test Results
- ✅ **Agent manifest** structure valid for Zed
- ✅ **stdio spawning** and communication works
- ✅ **Protocol version** compatibility verified
- ✅ **File activation patterns** correctly configured
- ✅ **Error recovery** scenarios handled
- ✅ **Agent lifecycle** management working

---

## 🧪 Regression Testing

Ensure existing functionality still works:

### Contract Tests (Should Still Pass)
```bash
cd container_src
pnpm vitest tests/contract/ --reporter=verbose
```

### HTTP API Compatibility (T021)
```bash
# Test that HTTP API still works alongside ACP
curl -s http://localhost:8787/health
```

---

## 🚨 Troubleshooting Common Issues

### Issue 1: Test Timeouts
**Symptoms**: Tests hang or timeout
**Solutions**:
```bash
# Increase test timeout
cd container_src
pnpm vitest tests/integration/ --testTimeout=30000

# Check for hanging processes
ps aux | grep node
kill -9 <pid-if-needed>
```

### Issue 2: Workspace Creation Failures
**Symptoms**: "Failed to create workspace directory"
**Solutions**:
```bash
# Check permissions
ls -la /tmp/
mkdir -p /tmp/acp-workspaces
chmod 755 /tmp/acp-workspaces
```

### Issue 3: Git Operations Failing
**Symptoms**: Git commands fail in workspace tests
**Solutions**:
```bash
# Ensure git is configured
git config --global user.name "Test User" || echo "Git config needed"
git config --global user.email "test@example.com" || echo "Git config needed"
```

### Issue 4: ANTHROPIC_API_KEY Errors
**Symptoms**: "Claude Code integration requires ANTHROPIC_API_KEY"
**Solutions**:
This is expected! The tests validate JSON-RPC structure even when API key is missing.
```bash
# Optional: Set API key for full functionality
export ANTHROPIC_API_KEY="your-api-key"
./test-t018-t020-complete.sh
```

### Issue 5: Build Failures
**Symptoms**: TypeScript compilation errors
**Solutions**:
```bash
cd container_src
# Clean and rebuild
rm -rf dist/
pnpm build

# Check for missing dependencies
pnpm install
```

---

## 📊 Success Criteria

### For T018 (Workspace Isolation)
- [ ] ✅ Workspace manager implementation exists and compiles
- [ ] ✅ File operations work within isolated boundaries
- [ ] ✅ Git operations function within workspaces
- [ ] ✅ Session cleanup works properly
- [ ] ✅ Security validation prevents path traversal

### For T019 (ACP Workflow Integration)
- [ ] ✅ Full workflow tests pass (initialize → session → prompt)
- [ ] ✅ Session isolation tests pass
- [ ] ✅ Error handling tests pass
- [ ] ✅ Concurrent operation tests pass
- [ ] ✅ Workspace integration tests pass

### For T020 (Zed Compatibility)
- [ ] ✅ Agent manifest validation passes
- [ ] ✅ stdio communication tests pass
- [ ] ✅ Protocol compatibility tests pass
- [ ] ✅ Activation pattern tests pass
- [ ] ✅ Lifecycle management tests pass

### Overall Success Metrics
- [ ] ✅ **Test Suite Success Rate**: ≥80% pass rate
- [ ] ✅ **No Critical Failures**: All core functionality working
- [ ] ✅ **Performance**: Container startup <5 seconds
- [ ] ✅ **Memory**: No memory leaks detected
- [ ] ✅ **Integration**: Works with existing HTTP API

---

## 🚀 Next Steps After Verification

Once T018-T020 are verified successful:

1. **Proceed to T021**: HTTP API compatibility testing
2. **Proceed to T022-T023**: Unit test coverage
3. **Proceed to T024**: Observability and logging
4. **Optional**: Performance optimization (T027)

### Quick Next Task Preview
```bash
# Preview what's next in the task list
grep -A 5 -B 2 "T021\|T022\|T023\|T024" specs/001-title-integrate-zed/tasks.md
```

---

## 📞 Need Help?

If tests are failing or you encounter issues:

1. **Check Prerequisites**: Ensure all dependencies are installed
2. **Review Logs**: Look at test output for specific error messages
3. **Check File Permissions**: Ensure workspace directories are writable
4. **Verify Git Setup**: Ensure git is properly configured
5. **Run Individual Tests**: Isolate failing tests to understand root cause

**Remember**: Some failures are expected (API key issues), but core JSON-RPC and workflow structure should work perfectly!

---

## ✅ Completion Verification

Run this final check to confirm everything is working:

```bash
# Final comprehensive verification
./test-t018-t020-complete.sh

# Should show:
# ✅ T018 - Workspace Isolation: COMPLETE
# ✅ T019 - ACP Workflow Integration Tests: COMPLETE
# ✅ T020 - Zed Editor Compatibility Tests: COMPLETE
# 🚀 Ready to proceed to T021-T024
```

**Congratulations! T018-T020 implementation is complete and verified!** 🎉