import { z } from 'zod';

export const automationContextSchema = z
  .record(z.string(), z.unknown())
  .optional();

const agentRoleSchema = z.enum([
  'orchestrator',
  'planner',
  'researcher',
  'coder',
  'tester',
  'reviewer',
  'database',
  'generic',
]);

const agentStepSchema = z.object({
  id: z.string(),
  order: z.number().int().nonnegative(),
  role: agentRoleSchema,
  subTask: z.string(),
  expectedOutput: z.string(),
  dependencies: z.array(z.string()).optional(),
  inputs: z.record(z.string(), z.unknown()).optional(),
});

const agentPlanSchema = z.object({
  id: z.string(),
  goal: z.string(),
  steps: z.array(agentStepSchema),
  createdAt: z.string(),
  model: z.string().optional(),
  notes: z.string().optional(),
});

const orchestrationContextSchema = z
  .object({
    planId: z.string().optional(),
    stepId: z.string().optional(),
    requestingAgent: agentRoleSchema.optional(),
    subTask: z.string().optional(),
    expectedOutput: z.string().optional(),
    plan: agentPlanSchema.optional(),
  })
  .partial();

export const agentContextSchema = z
  .record(z.string(), z.unknown())
  .and(
    z
      .object({
        orchestration: orchestrationContextSchema.optional(),
      })
      .partial(),
  )
  .optional();

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
