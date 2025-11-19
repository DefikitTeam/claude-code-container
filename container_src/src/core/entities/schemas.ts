import { z } from 'zod';

export const automationContextSchema = z
  .record(z.string(), z.unknown())
  .optional();

export const agentContextSchema = z.record(z.string(), z.unknown()).optional();

export const contentBlockMetadataSchema = z
  .object({
    filename: z.string().min(1).optional(),
    language: z.string().min(1).optional(),
    startLine: z.number().int().nonnegative().optional(),
    endLine: z.number().int().nonnegative().optional(),
    mimeType: z.string().min(1).optional(),
  })
  .catchall(z.unknown())
  .optional();

export const contentBlockSchema = z.object({
  type: z.enum(['text', 'image', 'diff', 'file', 'thought', 'error']),
  content: z.string().optional(),
  text: z.string().optional(),
  metadata: contentBlockMetadataSchema,
});

export const contentBlockArraySchema = z.array(contentBlockSchema);
