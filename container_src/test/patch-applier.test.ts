import { describe, it, expect } from 'vitest';
import { extractPatchesFromText } from '../src/services/prompt/patch-applier.js';

describe('patch-applier', () => {
  it('extracts fenced diff blocks', () => {
    const text =
      'Here is a patch:\n```diff\n--- a/file.txt\n+++ b/file.txt\n@@ -1 +1 @@\n-hello\n+hello world\n```\n';
    const patches = extractPatchesFromText(text);
    expect(patches.length).toBe(1);
    expect(patches[0]).toContain('@@ -1 +1 @@');
  });

  it('extracts raw diff starting with diff --git', () => {
    const text =
      'Please apply:\ndiff --git a/readme.md b/readme.md\nindex 123..456\n--- a/readme.md\n+++ b/readme.md\n@@ -1 +1 @@\n-old\n+new\n';
    const patches = extractPatchesFromText(text);
    expect(patches.length).toBeGreaterThanOrEqual(1);
    expect(patches[0]).toContain('diff --git');
  });

  it('returns empty for no patch', () => {
    const text = 'This is just instructions, no patch here.';
    const patches = extractPatchesFromText(text);
    expect(patches).toEqual([]);
  });
});
