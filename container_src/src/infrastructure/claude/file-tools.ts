/**
 * File System Tools for Vercel AI SDK
 * Provides Claude with file manipulation capabilities similar to @anthropic-ai/claude-code SDK
 */

import { tool } from 'ai';
import { z } from 'zod';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);

/**
 * File Tools Configuration
 */
export interface FileToolsConfig {
  workspacePath: string;
  allowedCommands?: string[]; // Whitelist of allowed bash commands
  maxFileSize?: number; // Max file size in bytes (default: 10MB)
}

/**
 * Create file system tools for the AI SDK
 */
export function createFileTools(config: FileToolsConfig) {
  const {
    workspacePath,
    allowedCommands = [
      'ls',
      'cat',
      'grep',
      'find',
      'git',
      'npm',
      'node',
      'python',
      'pip',
    ],
    maxFileSize = 10 * 1024 * 1024, // 10MB default
  } = config;

  /**
   * Resolve and validate file path within workspace
   */
  function resolvePath(relativePath: string): string {
    const resolved = path.resolve(workspacePath, relativePath);
    // Security: Ensure path is within workspace
    if (!resolved.startsWith(workspacePath)) {
      throw new Error(`Path ${relativePath} is outside workspace`);
    }
    return resolved;
  }

  /**
   * Tool: Read file contents
   */
  const readFileTool = tool({
    description: `Read the contents of a file from the workspace.

Use this to:
- Examine existing code before modifying it
- Understand the current implementation
- Check configuration files
- Read documentation or README files

IMPORTANT: Always read a file before modifying it to understand its current state and structure.

Example: readFile({ path: "src/components/Button.tsx" })`,
    inputSchema: z.object({
      path: z
        .string()
        .describe(
          'Path to the file relative to workspace root (e.g., "src/app.ts" or "package.json")',
        ),
    }),
    execute: async ({ path: filePath }) => {
      try {
        const fullPath = resolvePath(filePath);
        const stats = await fs.stat(fullPath);

        if (stats.size > maxFileSize) {
          return {
            success: false,
            error: `File too large: ${stats.size} bytes (max: ${maxFileSize})`,
          };
        }

        const content = await fs.readFile(fullPath, 'utf-8');
        return {
          success: true,
          path: filePath,
          content,
          size: stats.size,
        };
      } catch (error: unknown) {
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
  });

  /**
   * Tool: Write file contents
   */
  const writeFileTool = tool({
    description: `Write complete file contents to the workspace. This REPLACES the entire file.

Use this to:
- Create new files (tool automatically creates parent directories)
- Update existing files (must provide COMPLETE new file content)
- Fix bugs or add features to code files
- Modify configuration files

CRITICAL INSTRUCTIONS:
1. You must provide the COMPLETE file content, not just the changes
2. Include ALL imports, functions, and code - not just what changed
3. Maintain proper indentation and formatting
4. Match the existing code style (spaces vs tabs, line endings)
5. For existing files: Read the file first, then write the complete updated version

BAD (incomplete):
  writeFile({ path: "styles.css", content: "/* TODO: make background red */" })

GOOD (complete implementation):
  writeFile({ path: "styles.css", content: "body {\\n  background-color: red;\\n}\\n" })

Example workflow for modifying a file:
1. readFile({ path: "src/app.ts" }) // Read current content
2. Analyze what needs to change
3. writeFile({ path: "src/app.ts", content: "...COMPLETE FILE..." }) // Write entire file`,
    inputSchema: z.object({
      path: z
        .string()
        .describe(
          'Path to the file relative to workspace root (e.g., "src/utils/helper.ts")',
        ),
      content: z
        .string()
        .describe(
          'COMPLETE file content to write (not just changes - the entire file)',
        ),
    }),
    execute: async ({ path: filePath, content }) => {
      try {
        const fullPath = resolvePath(filePath);

        console.error('[FILE-TOOLS][writeFile] Writing file:', {
          workspacePath,
          relativePath: filePath,
          fullPath,
          contentSize: Buffer.byteLength(content, 'utf-8'),
        });

        // Create parent directory if it doesn't exist
        await fs.mkdir(path.dirname(fullPath), { recursive: true });

        // Write file
        await fs.writeFile(fullPath, content, 'utf-8');

        console.error('[FILE-TOOLS][writeFile] Successfully wrote file:', {
          fullPath,
          size: Buffer.byteLength(content, 'utf-8'),
        });

        return {
          success: true,
          path: filePath,
          size: Buffer.byteLength(content, 'utf-8'),
        };
      } catch (error: unknown) {
        console.error('[FILE-TOOLS][writeFile] Error writing file:', {
          fullPath: resolvePath(filePath),
          error: error instanceof Error ? error.message : String(error),
        });
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
  });

  /**
   * Tool: List directory contents
   */
  const listDirectoryTool = tool({
    description: `List contents of a directory to explore the project structure.

Use this to:
- Understand the project organization (start with path: ".")
- Find relevant files before making changes
- Discover test directories, configuration files, etc.
- Navigate the codebase structure

Best practice: Start by listing the root directory to understand the project layout.

Example:
  listDirectory({ path: ".", recursive: false }) // See top-level structure
  listDirectory({ path: "src", recursive: true })  // Deep exploration of src/`,
    inputSchema: z.object({
      path: z
        .string()
        .describe(
          'Path to directory relative to workspace root (use "." for root)',
        )
        .default('.'),
      recursive: z
        .boolean()
        .describe(
          'List subdirectories recursively (use false for quick overview, true for deep exploration)',
        )
        .default(false),
    }),
    execute: async ({ path: dirPath, recursive }) => {
      try {
        const fullPath = resolvePath(dirPath);

        if (recursive) {
          // Recursive listing
          const files: string[] = [];

          async function walk(dir: string, prefix: string = '') {
            const entries = await fs.readdir(dir, { withFileTypes: true });

            for (const entry of entries) {
              const relativePath = path.join(prefix, entry.name);
              files.push(
                entry.isDirectory() ? `${relativePath}/` : relativePath,
              );

              if (entry.isDirectory()) {
                await walk(path.join(dir, entry.name), relativePath);
              }
            }
          }

          await walk(fullPath);
          return {
            success: true,
            path: dirPath,
            files,
            count: files.length,
          };
        } else {
          // Non-recursive listing
          const entries = await fs.readdir(fullPath, { withFileTypes: true });
          const files = entries.map((entry) =>
            entry.isDirectory() ? `${entry.name}/` : entry.name,
          );

          return {
            success: true,
            path: dirPath,
            files,
            count: files.length,
          };
        }
      } catch (error: unknown) {
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
  });

  /**
   * Tool: Execute bash command (with safety restrictions)
   */
  const executeBashTool = tool({
    description: `Execute bash commands for testing, building, and git operations.

Allowed commands: ${allowedCommands.join(', ')}

Common use cases:
- Run tests: "npm test" or "pytest"
- Check git status: "git status"
- Install dependencies: "npm install" or "pip install"
- Build project: "npm run build"
- Run linters: "npm run lint"
- Execute project scripts: "npm run dev"

Examples:
  executeBash({ command: "git status" })           // Check for uncommitted changes
  executeBash({ command: "npm test" })             // Run test suite
  executeBash({ command: "ls -la src/" })          // List files with details
  executeBash({ command: "grep -r 'TODO' src/" }) // Search for TODOs

Note: Commands must start with one of the allowed commands for security.`,
    inputSchema: z.object({
      command: z
        .string()
        .describe(
          `Bash command to execute (must start with: ${allowedCommands.join(', ')})`,
        ),
    }),
    execute: async ({ command }) => {
      try {
        // Security: Check if command starts with an allowed command
        const commandBase = command.trim().split(/\s+/)[0];
        if (!allowedCommands.includes(commandBase)) {
          return {
            success: false,
            error: `Command '${commandBase}' not allowed. Allowed: ${allowedCommands.join(', ')}`,
          };
        }

        // Execute command in workspace directory
        const { stdout, stderr } = await execAsync(command, {
          cwd: workspacePath,
          timeout: 30000, // 30 second timeout
          maxBuffer: 1024 * 1024, // 1MB buffer
        });

        return {
          success: true,
          command,
          stdout: stdout.trim(),
          stderr: stderr.trim(),
        };
      } catch (error: unknown) {
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
          stderr: (error as { stderr?: string }).stderr || '',
          stdout: (error as { stdout?: string }).stdout || '',
        };
      }
    },
  });

  /**
   * Tool: Delete file or directory
   */
  const deletePathTool = tool({
    description: 'Delete a file or directory from the workspace',
    inputSchema: z.object({
      path: z
        .string()
        .describe('Path to file/directory relative to workspace root'),
      recursive: z
        .boolean()
        .describe('Delete directory recursively')
        .default(false),
    }),
    execute: async ({ path: targetPath, recursive }) => {
      try {
        const fullPath = resolvePath(targetPath);
        const stats = await fs.stat(fullPath);

        if (stats.isDirectory() && recursive) {
          await fs.rm(fullPath, { recursive: true, force: true });
          return {
            success: true,
            path: targetPath,
            type: 'directory',
          };
        } else if (stats.isDirectory()) {
          return {
            success: false,
            error: 'Path is a directory. Set recursive=true to delete.',
          };
        } else {
          await fs.unlink(fullPath);
          return {
            success: true,
            path: targetPath,
            type: 'file',
          };
        }
      } catch (error: unknown) {
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
  });

  /**
   * Tool: Move/rename file or directory
   */
  const movePathTool = tool({
    description: 'Move or rename a file or directory in the workspace',
    inputSchema: z.object({
      from: z.string().describe('Current path relative to workspace root'),
      to: z.string().describe('New path relative to workspace root'),
    }),
    execute: async ({ from, to }) => {
      try {
        const fromPath = resolvePath(from);
        const toPath = resolvePath(to);

        // Create parent directory if needed
        await fs.mkdir(path.dirname(toPath), { recursive: true });

        await fs.rename(fromPath, toPath);

        return {
          success: true,
          from,
          to,
        };
      } catch (error: unknown) {
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
  });

  // Return all tools
  return {
    readFile: readFileTool,
    writeFile: writeFileTool,
    listDirectory: listDirectoryTool,
    executeBash: executeBashTool,
    deletePath: deletePathTool,
    movePath: movePathTool,
  };
}

/**
 * Export type for tools
 */
export type FileTools = ReturnType<typeof createFileTools>;
