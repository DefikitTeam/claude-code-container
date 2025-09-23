import http from 'node:http';
import { URL } from 'node:url';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import simpleGit from 'simple-git';
import dotenv from 'dotenv';
import { ContainerGitHubClient } from './github_client.js';
dotenv.config();
const PORT = parseInt(process.env.PORT || '8080', 10);
const INSTANCE_ID = process.env.CONTAINER_ID || 'unknown';
function logWithContext(context, message, data) {
  const ts = new Date().toISOString();
  if (data)
    console.log(
      `[${ts}] [${context}] ${message}`,
      JSON.stringify(data, null, 2),
    );
  else console.log(`[${ts}] [${context}] ${message}`);
}
// Less forcing prompt preparation based on example/main.ts guidance
function prepareClaudePrompt(issue, repoSummary = null) {
  const guidance = `You are an automated code assistant. Your goal is to propose minimal, safe changes to address the issue described. Be explicit about why a change is needed, what files would change, provide short code snippets where helpful, and summarize the final change in one paragraph.`;
  let prompt = `Issue: #${issue.number} - ${issue.title}\n\n${issue.body}\n\n${guidance}`;
  if (repoSummary) prompt += `\n\nRepository summary:\n${repoSummary}`;
  // Ask the assistant to avoid strong forcing and to give options
  prompt += `\n\nPlease provide: (1) a short plan (2) specific small edits (3) tests or verification steps (4) a 1-2 sentence PR summary. If multiple safe options exist, list them and mark a recommended one.`;
  return prompt;
}
async function getRequestBody(req) {
  let body = '';
  for await (const chunk of req) body += chunk.toString();
  return body;
}
async function setupWorkspace(cloneUrl) {
  const workspaceDir = path.join(os.tmpdir(), `claude-workspace-${Date.now()}`);
  await fs.mkdir(workspaceDir, { recursive: true });
  logWithContext('WORKSPACE', 'Cloning repository', { cloneUrl, workspaceDir });
  const git = simpleGit();
  const token = process.env.GITHUB_TOKEN;
  const authenticated = token
    ? cloneUrl.replace(
        'https://github.com/',
        `https://x-access-token:${token}@github.com/`,
      )
    : cloneUrl;
  await git.clone(authenticated, workspaceDir, ['--depth', '1']);
  return workspaceDir;
}
async function cleanupWorkspace(dir) {
  try {
    await fs.rm(dir, { recursive: true, force: true });
    logWithContext('WORKSPACE', 'Cleaned up', { dir });
  } catch (e) {
    logWithContext('WORKSPACE', 'Cleanup failed', { dir, error: e.message });
  }
}
async function processIssueHandler(req, res) {
  try {
    const body = await getRequestBody(req);
    const payload = JSON.parse(body || '{}');
    const repoFull =
      payload.repository?.full_name || process.env.REPOSITORY_NAME;
    const [owner, repo] = (repoFull || '').split('/');
    const githubToken =
      process.env.GITHUB_TOKEN || payload.config?.installationToken;
    const issue = payload.issue || {
      number: payload.issue_number,
      title: payload.issue_title,
      body: payload.issue_body,
    };
    if (!owner || !repo)
      return sendJson(res, 400, {
        success: false,
        message: 'Missing repository info',
      });
    if (!issue || !issue.number)
      return sendJson(res, 400, {
        success: false,
        message: 'Missing issue info',
      });
    const client = new ContainerGitHubClient(githubToken, owner, repo);
    const cloneUrl =
      payload.repository?.clone_url || `https://github.com/${repoFull}.git`;
    const workspace = await setupWorkspace(cloneUrl);
    // prepare prompt with repo summary if available (read a small set of files)
    let repoSummary = null;
    try {
      const files = await fs.readdir(workspace);
      repoSummary = `Top-level files: ${files.slice(0, 10).join(', ')}`;
    } catch (e) {
      repoSummary = null;
    }
    const preparedPrompt = prepareClaudePrompt(issue, repoSummary);
    logWithContext('PROMPT', 'Prepared prompt', {
      length: preparedPrompt.length,
    });
    // For now we will not call Claude SDK here in the example; placeholder response
    const solution = {
      hasChanges: false,
      summary: 'Placeholder analysis - no changes applied.',
    };
    if (solution.hasChanges) {
      const branch = `claude-fix-${issue.number}`;
      // commit, push and create PR flow (left minimal here)
      await client.createPullRequest(
        `Fix: ${issue.title}`,
        solution.summary,
        branch,
        'main',
      );
      await cleanupWorkspace(workspace);
      return sendJson(res, 200, { success: true, message: 'PR created' });
    } else {
      await client.createComment(
        issue.number,
        `Automated analysis:\n\n${solution.summary}`,
      );
      await cleanupWorkspace(workspace);
      return sendJson(res, 200, { success: true, message: 'Comment posted' });
    }
  } catch (error) {
    logWithContext('PROCESS', 'Error processing issue', {
      error: error.message,
    });
    return sendJson(res, 500, { success: false, message: error.message });
  }
}
function sendJson(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(obj, null, 2));
}
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://localhost:${PORT}`);
  if (req.method === 'POST' && url.pathname === '/process-issue')
    return processIssueHandler(req, res);
  if (req.method === 'GET' && url.pathname === '/health')
    return sendJson(res, 200, { status: 'healthy', instance: INSTANCE_ID });
  return sendJson(res, 404, { success: false, message: 'not found' });
});
server.listen(PORT, '0.0.0.0', () => {
  logWithContext('SERVER', 'Started', { port: PORT, instance: INSTANCE_ID });
});
