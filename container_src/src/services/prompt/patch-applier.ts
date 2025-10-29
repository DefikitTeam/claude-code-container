/**
 * Simple patch extractor for model outputs.
 * - extracts fenced ```diff or ```patch blocks
 * - extracts raw unified-diff blocks (starting with "diff --git" or containing "@@ ")
 * - basic size checks
 */
const MAX_PATCH_BYTES = Number(process.env.ACP_MAX_PATCH_BYTES) || 200 * 1024; // 200 KB

export function extractPatchesFromText(text: string): string[] {
  if (!text || typeof text !== 'string') return [];
  const patches: string[] = [];
  // 1) fenced code blocks ```diff or ```patch
  const fenceRegex = /```(?:diff|patch)\n([\s\S]*?)```/gi;
  let m: RegExpExecArray | null;
  while ((m = fenceRegex.exec(text))) {
    const candidate = m[1].trim();
    if (isLikelyPatch(candidate)) patches.push(candidate);
  }

  // 2) raw blocks that start with diff --git ... capture until double newline or end
  const rawDiffRegex = /(diff --git[\s\S]*?)(?:\n\n|$)/gi;
  while ((m = rawDiffRegex.exec(text))) {
    const candidate = (m[1] || '').trim();
    if (candidate && isLikelyPatch(candidate)) patches.push(candidate);
  }

  // 3) fallback: extract contiguous region that contains at least one @@ hunk header
  const hunkRegex = /(^|\n)(diff --git[\s\S]*?|(?:^|\n)\+{3} [^\n\r]|@@ [^\n\r].*\n)/gi;
  if (!patches.length) {
    const all = text;
    const hunks: string[] = [];
    let idx = 0;
    const lines = all.split(/\r?\n/);
    while (idx < lines.length) {
      const line = lines[idx];
      if (line.startsWith('diff --git') || line.startsWith('@@ ') || line.startsWith('+++ ')) {
        // collect until empty line separating blocks
        let j = idx;
        const buf: string[] = [];
        while (j < lines.length) {
          buf.push(lines[j]);
          if (lines[j].trim() === '' && buf.length > 5) break;
          j++;
        }
        const candidate = buf.join('\n').trim();
        if (candidate && isLikelyPatch(candidate)) hunks.push(candidate);
        idx = j + 1;
      } else idx++;
    }
    patches.push(...hunks);
  }

  // final filter: size and uniqueness
  const out: string[] = [];
  for (const p of patches) {
    const bytes = Buffer.byteLength(p, 'utf8');
    if (bytes > MAX_PATCH_BYTES) continue;
    if (out.indexOf(p) === -1) out.push(p);
  }
  return out;
}

function isLikelyPatch(s: string): boolean {
  if (!s) return false;
  if (s.includes('diff --git')) return true;
  if (/^@@ /m.test(s)) return true;
  if (/^\+{3} /m.test(s) && /^--- /m.test(s)) return true;
  // minimal heuristic: contains file header or hunk markers and +/- lines
  if (/[+-]{3,}/.test(s) && /\n[+-]/.test(s)) return true;
  return false;
}

export default { extractPatchesFromText };

/**
 * Try to infer a file write from model prompt & output.
 * - filenameHint: searched from prompt text (e.g., "update styles.css")
 * - content: first fenced code block or whole text fallback
 */
export function extractFileWriteCandidate(
  promptText: string | undefined,
  fullText: string,
): { filename: string; content: string } | undefined {
  if (!fullText || typeof fullText !== 'string') return undefined;

  // find filename hint from promptText first
  const filenameRegex = /([\w\-./]+\.(?:js|ts|css|scss|md|html|json|yml|yaml|txt))/i;
  let filename: string | undefined;
  if (promptText && typeof promptText === 'string') {
    const m = promptText.match(filenameRegex);
    if (m) filename = m[1];
  }

  // if no filename in promptText, try to find in fullText (e.g., "styles.css" inside explanation)
  if (!filename) {
    const m2 = fullText.match(filenameRegex);
    if (m2) filename = m2[1];
  }

  // extract first fenced code block (any language)
  const fenceAny = /```(?:[^\n]*)\n([\s\S]*?)```/i;
  const fm = fullText.match(fenceAny);
  const content = fm ? fm[1].trim() : fullText.trim();

  if (filename && content && content.length > 0) {
    return { filename, content };
  }
  return undefined;
}
