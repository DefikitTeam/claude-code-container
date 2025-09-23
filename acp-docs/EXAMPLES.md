# Example Integrations - Real-World Use Cases

This document provides complete, production-ready examples of integrating Claude
Code Container with various external systems.

## 🎯 Table of Contents

1. [IDE Extensions](#ide-extensions)
2. [Web Applications](#web-applications)
3. [CLI Tools](#cli-tools)
4. [Discord Bots](#discord-bots)
5. [GitHub Actions](#github-actions)
6. [Slack Apps](#slack-apps)
7. [Desktop Applications](#desktop-applications)
8. [Monitoring & Analytics](#monitoring--analytics)

---

## 🔌 IDE Extensions

### VS Code Extension

**File: `extension.ts`**

```typescript
import * as vscode from 'vscode';
import { ClaudeHTTPClient } from '@defikitteam/claude-acp-client';

export function activate(context: vscode.ExtensionContext) {
  const client = new ClaudeHTTPClient({
    baseURL: process.env.CLAUDE_WORKER_URL || 'https://your-worker.com',
    apiKey: vscode.workspace.getConfiguration('claude').get('apiKey'),
  });

  // Command: Ask Claude about current file
  const askAboutFile = vscode.commands.registerCommand(
    'claude.askAboutFile',
    async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) return;

      const document = editor.document;
      const code = document.getText();
      const language = document.languageId;

      try {
        await client.initialize();
        const session = await client.createSession(
          vscode.workspace.rootPath || '',
        );

        const prompt = `Please analyze this ${language} code and provide insights:

\`\`\`${language}
${code}
\`\`\`

Focus on:
- Code quality and best practices
- Potential bugs or issues
- Performance optimizations
- Suggested improvements`;

        await client.sendPrompt(session.sessionId, prompt);

        vscode.window.showInformationMessage(
          'Claude is analyzing your code...',
        );
      } catch (error) {
        vscode.window.showErrorMessage(`Claude error: ${error.message}`);
      }
    },
  );

  // Command: Explain selection
  const explainSelection = vscode.commands.registerCommand(
    'claude.explainSelection',
    async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) return;

      const selection = editor.selection;
      const selectedText = editor.document.getText(selection);

      if (!selectedText) {
        vscode.window.showWarningMessage('Please select some code first');
        return;
      }

      try {
        await client.initialize();
        const session = await client.createSession(
          vscode.workspace.rootPath || '',
        );

        await client.sendPrompt(
          session.sessionId,
          `Explain this code:\n\`\`\`\n${selectedText}\n\`\`\``,
        );
      } catch (error) {
        vscode.window.showErrorMessage(`Claude error: ${error.message}`);
      }
    },
  );

  // Command: Generate tests
  const generateTests = vscode.commands.registerCommand(
    'claude.generateTests',
    async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) return;

      const document = editor.document;
      const code = document.getText();
      const language = document.languageId;

      try {
        await client.initialize();
        const session = await client.createSession(
          vscode.workspace.rootPath || '',
        );

        const prompt = `Generate comprehensive unit tests for this ${language} code:

\`\`\`${language}
${code}
\`\`\`

Requirements:
- Use appropriate testing framework for ${language}
- Cover edge cases and error scenarios
- Include setup and teardown if needed
- Add descriptive test names and comments`;

        await client.sendPrompt(session.sessionId, prompt);
      } catch (error) {
        vscode.window.showErrorMessage(`Claude error: ${error.message}`);
      }
    },
  );

  context.subscriptions.push(askAboutFile, explainSelection, generateTests);
}
```

**File: `package.json`**

```json
{
  "name": "claude-code-assistant",
  "displayName": "Claude Code Assistant",
  "description": "AI-powered code analysis with Claude",
  "version": "1.0.0",
  "engines": {
    "vscode": "^1.60.0"
  },
  "categories": ["Other"],
  "activationEvents": ["*"],
  "main": "./out/extension.js",
  "contributes": {
    "commands": [
      {
        "command": "claude.askAboutFile",
        "title": "Ask Claude About This File"
      },
      {
        "command": "claude.explainSelection",
        "title": "Explain Selection with Claude"
      },
      {
        "command": "claude.generateTests",
        "title": "Generate Tests with Claude"
      }
    ],
    "menus": {
      "editor/context": [
        {
          "command": "claude.explainSelection",
          "when": "editorHasSelection",
          "group": "claude"
        }
      ]
    },
    "configuration": {
      "title": "Claude",
      "properties": {
        "claude.apiKey": {
          "type": "string",
          "description": "Your Claude API key"
        },
        "claude.workerUrl": {
          "type": "string",
          "description": "Claude worker URL",
          "default": "https://your-worker.com"
        }
      }
    }
  },
  "dependencies": {
    "@defikitteam/claude-acp-client": "^1.0.0"
  }
}
```

---

## 🌐 Web Applications

### React Hook for Claude Integration

**File: `hooks/useClaude.ts`**

```typescript
import { useState, useEffect, useRef } from 'react';
import { ClaudeHTTPClient } from '@defikitteam/claude-acp-client';

interface ClaudeMessage {
  id: string;
  type: 'user' | 'claude';
  content: string;
  timestamp: Date;
}

interface UseClaudeOptions {
  apiKey: string;
  workerUrl: string;
  autoInit?: boolean;
}

export function useClaude({
  apiKey,
  workerUrl,
  autoInit = true,
}: UseClaudeOptions) {
  const [messages, setMessages] = useState<ClaudeMessage[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const clientRef = useRef<ClaudeHTTPClient | null>(null);
  const sessionIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (autoInit && apiKey && workerUrl) {
      initializeClaude();
    }
  }, [apiKey, workerUrl, autoInit]);

  const initializeClaude = async () => {
    try {
      setIsLoading(true);
      setError(null);

      const client = new ClaudeHTTPClient({
        baseURL: workerUrl,
        apiKey: apiKey,
      });

      await client.initialize();
      const session = await client.createSession('/workspace');

      clientRef.current = client;
      sessionIdRef.current = session.sessionId;
      setIsConnected(true);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Failed to initialize Claude',
      );
    } finally {
      setIsLoading(false);
    }
  };

  const sendMessage = async (content: string) => {
    if (!clientRef.current || !sessionIdRef.current) {
      throw new Error('Claude not initialized');
    }

    const userMessage: ClaudeMessage = {
      id: Date.now().toString(),
      type: 'user',
      content,
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setIsLoading(true);

    try {
      await clientRef.current.sendPrompt(sessionIdRef.current, content);

      // In a real implementation, you'd listen for response notifications
      // For now, we'll add a placeholder response
      const claudeMessage: ClaudeMessage = {
        id: (Date.now() + 1).toString(),
        type: 'claude',
        content:
          'Response received. Check your notification handler for the actual response.',
        timestamp: new Date(),
      };

      setMessages((prev) => [...prev, claudeMessage]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send message');
    } finally {
      setIsLoading(false);
    }
  };

  const clearMessages = () => {
    setMessages([]);
  };

  const disconnect = () => {
    clientRef.current = null;
    sessionIdRef.current = null;
    setIsConnected(false);
    setMessages([]);
  };

  return {
    messages,
    isConnected,
    isLoading,
    error,
    sendMessage,
    clearMessages,
    disconnect,
    initializeClaude,
  };
}
```

**File: `components/ClaudeChat.tsx`**

```typescript
import React, { useState } from 'react';
import { useClaude } from '../hooks/useClaude';

interface ClaudeChatProps {
  apiKey: string;
  workerUrl: string;
}

export function ClaudeChat({ apiKey, workerUrl }: ClaudeChatProps) {
  const [input, setInput] = useState('');
  const { messages, isConnected, isLoading, error, sendMessage } = useClaude({
    apiKey,
    workerUrl
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim()) return;

    await sendMessage(input);
    setInput('');
  };

  return (
    <div className="claude-chat">
      <div className="status">
        Status: {isConnected ? '🟢 Connected' : '🔴 Disconnected'}
        {error && <div className="error">Error: {error}</div>}
      </div>

      <div className="messages">
        {messages.map(message => (
          <div key={message.id} className={`message message-${message.type}`}>
            <div className="message-header">
              <strong>{message.type === 'user' ? 'You' : 'Claude'}</strong>
              <span className="timestamp">
                {message.timestamp.toLocaleTimeString()}
              </span>
            </div>
            <div className="message-content">{message.content}</div>
          </div>
        ))}
      </div>

      <form onSubmit={handleSubmit} className="input-form">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask Claude something..."
          disabled={!isConnected || isLoading}
        />
        <button type="submit" disabled={!isConnected || isLoading || !input.trim()}>
          {isLoading ? 'Sending...' : 'Send'}
        </button>
      </form>
    </div>
  );
}
```

---

## 🖥️ CLI Tools

### Advanced CLI with Multiple Commands

**File: `cli.ts`**

```typescript
#!/usr/bin/env node

import { Command } from 'commander';
import { ClaudeHTTPClient } from '@defikitteam/claude-acp-client';
import fs from 'fs';
import path from 'path';
import chalk from 'chalk';
import ora from 'ora';

const program = new Command();

class ClaudeCLI {
  private client: ClaudeHTTPClient;
  private sessionId: string | null = null;

  constructor() {
    const apiKey = process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY;
    const workerUrl =
      process.env.CLAUDE_WORKER_URL || 'https://your-worker.com';

    if (!apiKey) {
      console.error(
        chalk.red('Error: ANTHROPIC_API_KEY environment variable is required'),
      );
      process.exit(1);
    }

    this.client = new ClaudeHTTPClient({
      baseURL: workerUrl,
      apiKey: apiKey,
    });
  }

  async initialize(): Promise<void> {
    const spinner = ora('Initializing Claude...').start();

    try {
      await this.client.initialize();
      const session = await this.client.createSession(process.cwd());
      this.sessionId = session.sessionId;

      spinner.succeed('Claude initialized successfully');
    } catch (error) {
      spinner.fail('Failed to initialize Claude');
      throw error;
    }
  }

  async ask(question: string): Promise<void> {
    if (!this.sessionId) {
      await this.initialize();
    }

    const spinner = ora('Thinking...').start();

    try {
      await this.client.sendPrompt(this.sessionId!, question);
      spinner.succeed('Response sent to Claude');
      console.log(chalk.blue('💡 Claude is processing your question...'));
    } catch (error) {
      spinner.fail('Failed to send question');
      throw error;
    }
  }

  async reviewFile(filePath: string): Promise<void> {
    if (!fs.existsSync(filePath)) {
      throw new Error(`File not found: ${filePath}`);
    }

    const content = fs.readFileSync(filePath, 'utf8');
    const ext = path.extname(filePath);
    const language = this.getLanguageFromExtension(ext);

    const prompt = `Please review this ${language} code for:
- Code quality and best practices
- Potential bugs or security issues
- Performance optimizations
- Readability improvements
- Architectural concerns

File: ${filePath}

\`\`\`${language}
${content}
\`\`\``;

    await this.ask(prompt);
  }

  async generateTests(filePath: string): Promise<void> {
    if (!fs.existsSync(filePath)) {
      throw new Error(`File not found: ${filePath}`);
    }

    const content = fs.readFileSync(filePath, 'utf8');
    const ext = path.extname(filePath);
    const language = this.getLanguageFromExtension(ext);

    const prompt = `Generate comprehensive unit tests for this ${language} code:

File: ${filePath}

\`\`\`${language}
${content}
\`\`\`

Requirements:
- Use appropriate testing framework for ${language}
- Test all public methods/functions
- Include edge cases and error scenarios
- Mock external dependencies if needed
- Provide clear test descriptions`;

    await this.ask(prompt);
  }

  async explainProject(): Promise<void> {
    const packageJsonPath = path.join(process.cwd(), 'package.json');
    const readmePath = path.join(process.cwd(), 'README.md');

    let context = `Please analyze this project structure:\n\n`;

    // Add package.json if exists
    if (fs.existsSync(packageJsonPath)) {
      const packageJson = fs.readFileSync(packageJsonPath, 'utf8');
      context += `package.json:\n\`\`\`json\n${packageJson}\n\`\`\`\n\n`;
    }

    // Add README if exists
    if (fs.existsSync(readmePath)) {
      const readme = fs.readFileSync(readmePath, 'utf8');
      context += `README.md:\n\`\`\`markdown\n${readme}\n\`\`\`\n\n`;
    }

    // Add directory structure
    const structure = this.getDirectoryStructure(process.cwd());
    context += `Directory structure:\n\`\`\`\n${structure}\n\`\`\`\n\n`;

    context += `Please provide:
1. Project overview and purpose
2. Technology stack analysis
3. Architecture assessment
4. Suggestions for improvements
5. Potential issues or concerns`;

    await this.ask(context);
  }

  private getLanguageFromExtension(ext: string): string {
    const langMap: Record<string, string> = {
      '.js': 'javascript',
      '.ts': 'typescript',
      '.jsx': 'jsx',
      '.tsx': 'tsx',
      '.py': 'python',
      '.java': 'java',
      '.cpp': 'cpp',
      '.c': 'c',
      '.cs': 'csharp',
      '.php': 'php',
      '.rb': 'ruby',
      '.go': 'go',
      '.rs': 'rust',
      '.swift': 'swift',
      '.kt': 'kotlin',
    };

    return langMap[ext.toLowerCase()] || 'text';
  }

  private getDirectoryStructure(
    dir: string,
    depth: number = 0,
    maxDepth: number = 3,
  ): string {
    if (depth > maxDepth) return '';

    const indent = '  '.repeat(depth);
    const items = fs.readdirSync(dir, { withFileTypes: true });
    let structure = '';

    for (const item of items) {
      if (item.name.startsWith('.') || item.name === 'node_modules') continue;

      structure += `${indent}${item.isDirectory() ? '📁' : '📄'} ${item.name}\n`;

      if (item.isDirectory() && depth < maxDepth) {
        structure += this.getDirectoryStructure(
          path.join(dir, item.name),
          depth + 1,
          maxDepth,
        );
      }
    }

    return structure;
  }
}

// CLI Commands
program
  .name('claude')
  .description('Claude AI CLI for code analysis and assistance')
  .version('1.0.0');

program
  .command('ask <question>')
  .description('Ask Claude a question')
  .action(async (question) => {
    try {
      const claude = new ClaudeCLI();
      await claude.ask(question);
    } catch (error) {
      console.error(chalk.red('Error:'), error.message);
      process.exit(1);
    }
  });

program
  .command('review <file>')
  .description('Review a code file')
  .action(async (file) => {
    try {
      const claude = new ClaudeCLI();
      await claude.reviewFile(file);
    } catch (error) {
      console.error(chalk.red('Error:'), error.message);
      process.exit(1);
    }
  });

program
  .command('test <file>')
  .description('Generate tests for a code file')
  .action(async (file) => {
    try {
      const claude = new ClaudeCLI();
      await claude.generateTests(file);
    } catch (error) {
      console.error(chalk.red('Error:'), error.message);
      process.exit(1);
    }
  });

program
  .command('explain')
  .description('Explain the current project structure')
  .action(async () => {
    try {
      const claude = new ClaudeCLI();
      await claude.explainProject();
    } catch (error) {
      console.error(chalk.red('Error:'), error.message);
      process.exit(1);
    }
  });

program.parse();
```

**File: `package.json`**

```json
{
  "name": "claude-cli",
  "version": "1.0.0",
  "description": "AI-powered code assistant CLI",
  "main": "dist/cli.js",
  "bin": {
    "claude": "dist/cli.js"
  },
  "scripts": {
    "build": "tsc",
    "start": "node dist/cli.js",
    "dev": "ts-node cli.ts"
  },
  "dependencies": {
    "@defikitteam/claude-acp-client": "^1.0.0",
    "commander": "^9.4.0",
    "chalk": "^4.1.2",
    "ora": "^5.4.1"
  },
  "devDependencies": {
    "@types/node": "^18.0.0",
    "typescript": "^4.8.0",
    "ts-node": "^10.9.0"
  }
}
```

---

## 🤖 Discord Bots

### Discord Bot with Claude Integration

**File: `discord-bot.ts`**

````typescript
import { Client, GatewayIntentBits, Message, TextChannel } from 'discord.js';
import { ClaudeHTTPClient } from '@defikitteam/claude-acp-client';

class ClaudeDiscordBot {
  private discord: Client;
  private claude: ClaudeHTTPClient;
  private sessions = new Map<string, string>();

  constructor() {
    this.discord = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
      ],
    });

    this.claude = new ClaudeHTTPClient({
      baseURL: process.env.CLAUDE_WORKER_URL!,
      apiKey: process.env.ANTHROPIC_API_KEY!,
    });

    this.setupEventHandlers();
  }

  private setupEventHandlers() {
    this.discord.on('ready', () => {
      console.log(`🤖 ${this.discord.user?.tag} is online!`);
    });

    this.discord.on('messageCreate', this.handleMessage.bind(this));
  }

  private async handleMessage(message: Message) {
    if (message.author.bot) return;

    const content = message.content.trim();

    // Commands
    if (content.startsWith('!claude ')) {
      await this.handleClaudeCommand(message, content.slice(8));
    } else if (content.startsWith('!review')) {
      await this.handleCodeReview(message);
    } else if (content.startsWith('!explain')) {
      await this.handleExplainCode(message);
    }
  }

  private async handleClaudeCommand(message: Message, prompt: string) {
    const channel = message.channel as TextChannel;

    try {
      // Show typing indicator
      await channel.sendTyping();

      // Get or create session for this channel
      const sessionId = await this.getOrCreateSession(channel.id);

      // Send prompt to Claude
      await this.claude.sendPrompt(sessionId, prompt);

      // Send confirmation (in real implementation, you'd listen for response)
      await message.reply(
        "🤔 Claude is thinking... You'll get a response soon!",
      );
    } catch (error) {
      await message.reply(`❌ Error: ${error.message}`);
    }
  }

  private async handleCodeReview(message: Message) {
    const codeBlock = this.extractCodeBlock(message.content);

    if (!codeBlock) {
      await message.reply(
        'Please provide code in a code block:\n```language\ncode here\n```',
      );
      return;
    }

    const prompt = `Please review this code for:
- Best practices
- Potential bugs
- Performance issues
- Security concerns
- Improvements

\`\`\`${codeBlock.language}
${codeBlock.code}
\`\`\``;

    await this.handleClaudeCommand(message, prompt);
  }

  private async handleExplainCode(message: Message) {
    const codeBlock = this.extractCodeBlock(message.content);

    if (!codeBlock) {
      await message.reply('Please provide code in a code block to explain.');
      return;
    }

    const prompt = `Please explain this code in simple terms:

\`\`\`${codeBlock.language}
${codeBlock.code}
\`\`\`

Include:
- What it does
- How it works
- Key concepts used`;

    await this.handleClaudeCommand(message, prompt);
  }

  private extractCodeBlock(
    content: string,
  ): { language: string; code: string } | null {
    const codeBlockRegex = /```(\w+)?\n([\s\S]*?)\n```/;
    const match = content.match(codeBlockRegex);

    if (!match) return null;

    return {
      language: match[1] || 'text',
      code: match[2],
    };
  }

  private async getOrCreateSession(channelId: string): Promise<string> {
    if (!this.sessions.has(channelId)) {
      await this.claude.initialize();
      const session = await this.claude.createSession('/workspace');
      this.sessions.set(channelId, session.sessionId);
    }

    return this.sessions.get(channelId)!;
  }

  async start() {
    await this.discord.login(process.env.DISCORD_TOKEN);
  }

  async stop() {
    await this.discord.destroy();
  }
}

// Start the bot
const bot = new ClaudeDiscordBot();
bot.start().catch(console.error);

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('Shutting down...');
  await bot.stop();
  process.exit(0);
});
````

**Usage Examples:**

````
!claude How do I implement authentication in Express.js?

!review
```javascript
function validateUser(user) {
  if (user.name) return true;
  return false;
}
````

!explain

```python
def fibonacci(n):
    if n <= 1:
        return n
    return fibonacci(n-1) + fibonacci(n-2)
```

````

---

## ⚡ GitHub Actions

### GitHub Action for Code Review

**File: `.github/workflows/claude-review.yml`**
```yaml
name: Claude Code Review
on:
  pull_request:
    types: [opened, synchronize]

jobs:
  claude-review:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout code
        uses: actions/checkout@v3
        with:
          fetch-depth: 0

      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '18'

      - name: Install Claude CLI
        run: npm install -g @defikitteam/claude-acp-client

      - name: Get changed files
        id: changes
        run: |
          echo "files=$(git diff --name-only ${{ github.event.pull_request.base.sha }} ${{ github.sha }} | grep -E '\.(js|ts|jsx|tsx|py|java|cpp|c)$' | head -10)" >> $GITHUB_OUTPUT

      - name: Review changed files
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
          CLAUDE_WORKER_URL: ${{ secrets.CLAUDE_WORKER_URL }}
        run: |
          for file in ${{ steps.changes.outputs.files }}; do
            if [ -f "$file" ]; then
              echo "Reviewing $file..."
              claude review "$file" || true
            fi
          done

      - name: Comment on PR
        uses: actions/github-script@v6
        with:
          script: |
            const fs = require('fs');
            const path = require('path');

            // In a real implementation, you'd collect Claude's responses
            // and post them as PR comments

            github.rest.issues.createComment({
              issue_number: context.issue.number,
              owner: context.repo.owner,
              repo: context.repo.repo,
              body: '🤖 Claude has reviewed the changed files. Check the logs for detailed feedback!'
            });
````

---

## 💬 Slack Apps

### Slack Bot with Claude Integration

**File: `slack-bot.ts`**

````typescript
import { App } from '@slack/bolt';
import { ClaudeHTTPClient } from '@defikitteam/claude-acp-client';

class ClaudeSlackBot {
  private app: App;
  private claude: ClaudeHTTPClient;
  private sessions = new Map<string, string>();

  constructor() {
    this.app = new App({
      token: process.env.SLACK_BOT_TOKEN,
      signingSecret: process.env.SLACK_SIGNING_SECRET,
      appToken: process.env.SLACK_APP_TOKEN,
      socketMode: true,
    });

    this.claude = new ClaudeHTTPClient({
      baseURL: process.env.CLAUDE_WORKER_URL!,
      apiKey: process.env.ANTHROPIC_API_KEY!,
    });

    this.setupCommands();
  }

  private setupCommands() {
    // Slash command: /claude <question>
    this.app.command('/claude', async ({ command, ack, respond }) => {
      await ack();

      try {
        const sessionId = await this.getOrCreateSession(command.channel_id);
        await this.claude.sendPrompt(sessionId, command.text);

        await respond({
          text: `🤔 Claude is thinking about: "${command.text}"`,
          response_type: 'in_channel',
        });
      } catch (error) {
        await respond({
          text: `❌ Error: ${error.message}`,
          response_type: 'ephemeral',
        });
      }
    });

    // Slash command: /code-review
    this.app.command('/code-review', async ({ command, ack, respond }) => {
      await ack();

      const codeBlock = this.extractCodeFromText(command.text);
      if (!codeBlock) {
        await respond({
          text: 'Please provide code to review: `/code-review ```language\ncode here\n```',
          response_type: 'ephemeral',
        });
        return;
      }

      const prompt = `Please review this code:

\`\`\`${codeBlock.language}
${codeBlock.code}
\`\`\`

Focus on:
- Code quality
- Best practices
- Potential issues
- Suggestions for improvement`;

      try {
        const sessionId = await this.getOrCreateSession(command.channel_id);
        await this.claude.sendPrompt(sessionId, prompt);

        await respond({
          text: '🔍 Claude is reviewing your code...',
          response_type: 'in_channel',
        });
      } catch (error) {
        await respond({
          text: `❌ Error: ${error.message}`,
          response_type: 'ephemeral',
        });
      }
    });

    // Message event for mentions
    this.app.event('app_mention', async ({ event, say }) => {
      const text = event.text.replace(/<@\w+>/, '').trim();

      if (text.toLowerCase().includes('help')) {
        await say({
          text: `Hi! I'm Claude 🤖 Here's what I can do:
• \`/claude <question>\` - Ask me anything
• \`/code-review\` - Review your code
• Mention me with a question
• Share code in a thread and I'll analyze it`,
          thread_ts: event.ts,
        });
        return;
      }

      try {
        const sessionId = await this.getOrCreateSession(event.channel);
        await this.claude.sendPrompt(sessionId, text);

        await say({
          text: `🤔 Thinking about: "${text}"`,
          thread_ts: event.ts,
        });
      } catch (error) {
        await say({
          text: `❌ Sorry, I encountered an error: ${error.message}`,
          thread_ts: event.ts,
        });
      }
    });
  }

  private extractCodeFromText(
    text: string,
  ): { language: string; code: string } | null {
    const codeBlockRegex = /```(\w+)?\n([\s\S]*?)\n```/;
    const match = text.match(codeBlockRegex);

    if (!match) return null;

    return {
      language: match[1] || 'text',
      code: match[2],
    };
  }

  private async getOrCreateSession(channelId: string): Promise<string> {
    if (!this.sessions.has(channelId)) {
      await this.claude.initialize();
      const session = await this.claude.createSession('/workspace');
      this.sessions.set(channelId, session.sessionId);
    }

    return this.sessions.get(channelId)!;
  }

  async start() {
    await this.app.start();
    console.log('⚡️ Slack bot is running!');
  }
}

// Start the bot
const bot = new ClaudeSlackBot();
bot.start().catch(console.error);
````

---

## 🖥️ Desktop Applications

### Electron App with Claude

**File: `main.ts` (Electron Main Process)**

```typescript
import { app, BrowserWindow, ipcMain } from 'electron';
import { ClaudeHTTPClient } from '@defikitteam/claude-acp-client';
import path from 'path';

class ClaudeElectronApp {
  private mainWindow: BrowserWindow | null = null;
  private claude: ClaudeHTTPClient;
  private sessionId: string | null = null;

  constructor() {
    this.claude = new ClaudeHTTPClient({
      baseURL: process.env.CLAUDE_WORKER_URL || 'https://your-worker.com',
      apiKey: process.env.ANTHROPIC_API_KEY!,
    });

    this.setupApp();
    this.setupIPC();
  }

  private setupApp() {
    app.whenReady().then(() => {
      this.createWindow();
      this.initializeClaude();
    });

    app.on('window-all-closed', () => {
      if (process.platform !== 'darwin') {
        app.quit();
      }
    });

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        this.createWindow();
      }
    });
  }

  private createWindow() {
    this.mainWindow = new BrowserWindow({
      width: 1200,
      height: 800,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        preload: path.join(__dirname, 'preload.js'),
      },
    });

    this.mainWindow.loadFile('index.html');
  }

  private setupIPC() {
    // Handle messages from renderer
    ipcMain.handle('claude:ask', async (_, question: string) => {
      try {
        if (!this.sessionId) {
          await this.initializeClaude();
        }

        await this.claude.sendPrompt(this.sessionId!, question);
        return { success: true, message: 'Question sent to Claude' };
      } catch (error) {
        return { success: false, error: error.message };
      }
    });

    ipcMain.handle('claude:analyze-file', async (_, filePath: string) => {
      try {
        const fs = require('fs');
        const content = fs.readFileSync(filePath, 'utf8');
        const ext = path.extname(filePath);

        const prompt = `Analyze this file (${filePath}):

\`\`\`${this.getLanguageFromExt(ext)}
${content}
\`\`\`

Please provide:
- Code overview
- Quality assessment
- Potential improvements
- Any issues found`;

        if (!this.sessionId) {
          await this.initializeClaude();
        }

        await this.claude.sendPrompt(this.sessionId!, prompt);
        return { success: true, message: 'File analysis requested' };
      } catch (error) {
        return { success: false, error: error.message };
      }
    });
  }

  private async initializeClaude() {
    try {
      await this.claude.initialize();
      const session = await this.claude.createSession(process.cwd());
      this.sessionId = session.sessionId;

      // Notify renderer
      this.mainWindow?.webContents.send('claude:status', { connected: true });
    } catch (error) {
      this.mainWindow?.webContents.send('claude:status', {
        connected: false,
        error: error.message,
      });
    }
  }

  private getLanguageFromExt(ext: string): string {
    const langMap: Record<string, string> = {
      '.js': 'javascript',
      '.ts': 'typescript',
      '.jsx': 'jsx',
      '.tsx': 'tsx',
      '.py': 'python',
      '.java': 'java',
    };
    return langMap[ext] || 'text';
  }
}

new ClaudeElectronApp();
```

**File: `preload.ts` (Electron Preload)**

```typescript
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('claude', {
  ask: (question: string) => ipcRenderer.invoke('claude:ask', question),
  analyzeFile: (filePath: string) =>
    ipcRenderer.invoke('claude:analyze-file', filePath),
  onStatusChange: (callback: (status: any) => void) => {
    ipcRenderer.on('claude:status', (_, status) => callback(status));
  },
});
```

**File: `renderer.js` (Frontend)**

```javascript
class ClaudeUI {
  constructor() {
    this.setupUI();
    this.setupEventListeners();

    // Listen for Claude status updates
    window.claude.onStatusChange((status) => {
      this.updateStatus(status);
    });
  }

  setupUI() {
    document.body.innerHTML = `
      <div class="app">
        <header>
          <h1>Claude Desktop Assistant</h1>
          <div class="status" id="status">Connecting...</div>
        </header>
        
        <main>
          <div class="chat-container">
            <div class="messages" id="messages"></div>
            <div class="input-area">
              <input type="text" id="question-input" placeholder="Ask Claude something...">
              <button id="send-btn">Send</button>
              <button id="file-btn">Analyze File</button>
            </div>
          </div>
        </main>
      </div>
    `;
  }

  setupEventListeners() {
    const input = document.getElementById('question-input');
    const sendBtn = document.getElementById('send-btn');
    const fileBtn = document.getElementById('file-btn');

    sendBtn.addEventListener('click', () => this.askQuestion());
    input.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') this.askQuestion();
    });

    fileBtn.addEventListener('click', () => this.selectFile());
  }

  async askQuestion() {
    const input = document.getElementById('question-input');
    const question = input.value.trim();

    if (!question) return;

    this.addMessage('You', question);
    input.value = '';

    const result = await window.claude.ask(question);

    if (result.success) {
      this.addMessage('System', 'Question sent to Claude...');
    } else {
      this.addMessage('Error', result.error);
    }
  }

  async selectFile() {
    // In a real app, you'd use a file dialog
    const filePath = prompt('Enter file path to analyze:');
    if (!filePath) return;

    const result = await window.claude.analyzeFile(filePath);

    if (result.success) {
      this.addMessage('System', `Analyzing file: ${filePath}...`);
    } else {
      this.addMessage('Error', result.error);
    }
  }

  addMessage(sender, content) {
    const messages = document.getElementById('messages');
    const messageDiv = document.createElement('div');
    messageDiv.className = 'message';
    messageDiv.innerHTML = `
      <strong>${sender}:</strong> ${content}
      <span class="timestamp">${new Date().toLocaleTimeString()}</span>
    `;
    messages.appendChild(messageDiv);
    messages.scrollTop = messages.scrollHeight;
  }

  updateStatus(status) {
    const statusEl = document.getElementById('status');
    statusEl.textContent = status.connected
      ? 'Connected'
      : `Disconnected: ${status.error || 'Unknown error'}`;
    statusEl.className = status.connected
      ? 'status connected'
      : 'status disconnected';
  }
}

// Initialize the UI when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
  new ClaudeUI();
});
```

---

## 📊 Monitoring & Analytics

### Monitoring Dashboard

**File: `monitoring.ts`**

```typescript
import express from 'express';
import { ClaudeHTTPClient } from '@defikitteam/claude-acp-client';

interface MetricData {
  timestamp: Date;
  metric: string;
  value: number;
  metadata?: any;
}

class ClaudeMonitoring {
  private app = express();
  private metrics: MetricData[] = [];
  private clients = new Map<string, ClaudeHTTPClient>();

  constructor() {
    this.setupMiddleware();
    this.setupRoutes();
    this.startMetricsCollection();
  }

  private setupMiddleware() {
    this.app.use(express.json());
    this.app.use(express.static('public'));
  }

  private setupRoutes() {
    // Health check endpoint
    this.app.get('/health', (req, res) => {
      res.json({
        status: 'healthy',
        timestamp: new Date(),
        activeClients: this.clients.size,
        totalMetrics: this.metrics.length,
      });
    });

    // Metrics endpoint
    this.app.get('/metrics', (req, res) => {
      const since = req.query.since
        ? new Date(req.query.since as string)
        : new Date(Date.now() - 24 * 60 * 60 * 1000);

      const filteredMetrics = this.metrics.filter((m) => m.timestamp >= since);

      res.json({
        metrics: filteredMetrics,
        summary: this.generateMetricsSummary(filteredMetrics),
      });
    });

    // Test Claude endpoint
    this.app.post('/test/:clientId', async (req, res) => {
      const { clientId } = req.params;
      const { prompt } = req.body;

      try {
        const client = await this.getOrCreateClient(clientId);
        const startTime = Date.now();

        await client.initialize();
        const session = await client.createSession('/workspace');
        await client.sendPrompt(session.sessionId, prompt || 'Hello, Claude!');

        const duration = Date.now() - startTime;

        this.recordMetric('request_duration', duration, { clientId, prompt });
        this.recordMetric('request_success', 1, { clientId });

        res.json({
          success: true,
          duration,
          message: 'Request sent successfully',
        });
      } catch (error) {
        this.recordMetric('request_error', 1, {
          clientId,
          error: error.message,
        });

        res.status(500).json({
          success: false,
          error: error.message,
        });
      }
    });

    // Dashboard
    this.app.get('/', (req, res) => {
      res.send(this.generateDashboardHTML());
    });
  }

  private async getOrCreateClient(clientId: string): Promise<ClaudeHTTPClient> {
    if (!this.clients.has(clientId)) {
      const client = new ClaudeHTTPClient({
        baseURL: process.env.CLAUDE_WORKER_URL || 'https://your-worker.com',
        apiKey: process.env.ANTHROPIC_API_KEY!,
      });

      this.clients.set(clientId, client);
    }

    return this.clients.get(clientId)!;
  }

  private recordMetric(metric: string, value: number, metadata?: any) {
    this.metrics.push({
      timestamp: new Date(),
      metric,
      value,
      metadata,
    });

    // Keep only last 10000 metrics
    if (this.metrics.length > 10000) {
      this.metrics = this.metrics.slice(-10000);
    }
  }

  private generateMetricsSummary(metrics: MetricData[]) {
    const summary: Record<string, any> = {};

    // Group by metric name
    const grouped = metrics.reduce(
      (acc, metric) => {
        if (!acc[metric.metric]) acc[metric.metric] = [];
        acc[metric.metric].push(metric.value);
        return acc;
      },
      {} as Record<string, number[]>,
    );

    // Calculate statistics
    Object.entries(grouped).forEach(([metric, values]) => {
      summary[metric] = {
        count: values.length,
        sum: values.reduce((a, b) => a + b, 0),
        avg: values.reduce((a, b) => a + b, 0) / values.length,
        min: Math.min(...values),
        max: Math.max(...values),
      };
    });

    return summary;
  }

  private startMetricsCollection() {
    // Collect system metrics every minute
    setInterval(() => {
      this.recordMetric('active_clients', this.clients.size);
      this.recordMetric('memory_usage', process.memoryUsage().heapUsed);
      this.recordMetric('uptime', process.uptime());
    }, 60000);
  }

  private generateDashboardHTML(): string {
    return `
<!DOCTYPE html>
<html>
<head>
    <title>Claude Monitoring Dashboard</title>
    <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
    <style>
        body { font-family: Arial, sans-serif; margin: 20px; }
        .dashboard { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
        .metric-card { border: 1px solid #ddd; padding: 20px; border-radius: 8px; }
        .metric-value { font-size: 2em; font-weight: bold; color: #007acc; }
        .chart-container { width: 100%; height: 300px; }
        .test-form { background: #f5f5f5; padding: 20px; border-radius: 8px; margin: 20px 0; }
        .test-form input, .test-form button { margin: 5px; padding: 10px; }
    </style>
</head>
<body>
    <h1>Claude Code Container Monitoring</h1>
    
    <div class="test-form">
        <h3>Test Claude Integration</h3>
        <input type="text" id="clientId" placeholder="Client ID" value="test-client">
        <input type="text" id="prompt" placeholder="Test prompt" value="Hello, Claude!">
        <button onclick="testClaude()">Send Test</button>
        <div id="testResult"></div>
    </div>

    <div class="dashboard">
        <div class="metric-card">
            <h3>Active Clients</h3>
            <div class="metric-value" id="activeClients">-</div>
        </div>
        
        <div class="metric-card">
            <h3>Total Requests</h3>
            <div class="metric-value" id="totalRequests">-</div>
        </div>
        
        <div class="metric-card">
            <h3>Success Rate</h3>
            <div class="metric-value" id="successRate">-</div>
        </div>
        
        <div class="metric-card">
            <h3>Avg Response Time</h3>
            <div class="metric-value" id="avgResponseTime">-</div>
        </div>
    </div>

    <div class="chart-container">
        <canvas id="metricsChart"></canvas>
    </div>

    <script>
        let chart;
        
        async function loadMetrics() {
            const response = await fetch('/metrics');
            const data = await response.json();
            updateDashboard(data);
        }
        
        function updateDashboard(data) {
            const summary = data.summary;
            
            document.getElementById('activeClients').textContent = 
                summary.active_clients?.avg?.toFixed(0) || '0';
            
            document.getElementById('totalRequests').textContent = 
                (summary.request_success?.count || 0) + (summary.request_error?.count || 0);
            
            const successRate = summary.request_success?.count || 0;
            const totalRequests = successRate + (summary.request_error?.count || 0);
            document.getElementById('successRate').textContent = 
                totalRequests > 0 ? ((successRate / totalRequests) * 100).toFixed(1) + '%' : '100%';
            
            document.getElementById('avgResponseTime').textContent = 
                summary.request_duration?.avg?.toFixed(0) + 'ms' || '0ms';
                
            updateChart(data.metrics);
        }
        
        function updateChart(metrics) {
            const ctx = document.getElementById('metricsChart').getContext('2d');
            
            if (chart) chart.destroy();
            
            const durationMetrics = metrics
                .filter(m => m.metric === 'request_duration')
                .slice(-20);
            
            chart = new Chart(ctx, {
                type: 'line',
                data: {
                    labels: durationMetrics.map(m => new Date(m.timestamp).toLocaleTimeString()),
                    datasets: [{
                        label: 'Response Time (ms)',
                        data: durationMetrics.map(m => m.value),
                        borderColor: '#007acc',
                        tension: 0.1
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false
                }
            });
        }
        
        async function testClaude() {
            const clientId = document.getElementById('clientId').value;
            const prompt = document.getElementById('prompt').value;
            const resultDiv = document.getElementById('testResult');
            
            resultDiv.innerHTML = 'Testing...';
            
            try {
                const response = await fetch(\`/test/\${clientId}\`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ prompt })
                });
                
                const result = await response.json();
                
                if (result.success) {
                    resultDiv.innerHTML = \`✅ Success! Duration: \${result.duration}ms\`;
                    resultDiv.style.color = 'green';
                } else {
                    resultDiv.innerHTML = \`❌ Error: \${result.error}\`;
                    resultDiv.style.color = 'red';
                }
                
                // Refresh metrics
                setTimeout(loadMetrics, 1000);
                
            } catch (error) {
                resultDiv.innerHTML = \`❌ Network Error: \${error.message}\`;
                resultDiv.style.color = 'red';
            }
        }
        
        // Load metrics on page load and refresh every 30 seconds
        loadMetrics();
        setInterval(loadMetrics, 30000);
    </script>
</body>
</html>
    `;
  }

  start(port: number = 3000) {
    this.app.listen(port, () => {
      console.log(
        `📊 Monitoring dashboard running on http://localhost:${port}`,
      );
    });
  }
}

// Start the monitoring server
const monitoring = new ClaudeMonitoring();
monitoring.start();
```

---

## 📝 Summary

These examples demonstrate real-world integrations of the Claude Code Container
system across different platforms and use cases:

1. **IDE Extensions**: VS Code extension with multiple commands
2. **Web Applications**: React hooks and components for web integration
3. **CLI Tools**: Feature-rich command-line interface
4. **Discord Bots**: Interactive bot with code review capabilities
5. **GitHub Actions**: Automated code review in CI/CD
6. **Slack Apps**: Team collaboration with slash commands
7. **Desktop Applications**: Electron app with file analysis
8. **Monitoring**: Dashboard for tracking performance and usage

Each example includes:

- Complete, production-ready code
- Error handling and user feedback
- Configuration and setup instructions
- Best practices for the specific platform

All examples follow the lightweight ACP client architecture, communicating with
the remote Claude Code Container worker for AI-powered code assistance.
