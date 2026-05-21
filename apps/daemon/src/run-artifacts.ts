// Daemon-side helper that counts how many distinct `.html` files this
// run produced or modified. Fed into v2 `run_finished.artifact_count`.
//
// Semantics (per product spec, 2026-05-21):
//   - Count is incremental for THIS run only, not cumulative across the
//     project. If the run touched no `.html` files, the count is 0.
//   - A file written multiple times within the same run counts once
//     (dedup by path) so a Write-then-Edit cycle on the same file
//     reports one artifact, not two.
//   - Both Write (create_file) and Edit / MultiEdit count, because the
//     agent often writes a skeleton then edits to fill it in; both end
//     in a new file state at run end.
//   - Read-only ops never count.
//
// Earlier `server.ts:11061` hard-coded `artifact_count: 0`, which
// produced uniform zero on PostHog and made the v2 "generation
// success → produced artifact" funnel useless.

// Tool names cover Claude-style, Codex-style, and the ACP/MCP shapes
// the daemon proxies. Keep aligned with the web-side `WRITE_NAMES` /
// `EDIT_NAMES` sets in `apps/web/src/runtime/file-ops.ts`.
const WRITE_OR_EDIT_TOOL_NAMES: ReadonlySet<string> = new Set([
  'Write',
  'create_file',
  'Edit',
  'str_replace_edit',
  'MultiEdit',
  'multi_edit',
]);

function extractToolFilePath(input: unknown): string | null {
  if (!input || typeof input !== 'object') return null;
  const obj = input as { file_path?: unknown; path?: unknown };
  if (typeof obj.file_path === 'string' && obj.file_path) return obj.file_path;
  if (typeof obj.path === 'string' && obj.path) return obj.path;
  return null;
}

function isHtmlPath(path: string): boolean {
  return path.toLowerCase().endsWith('.html');
}

export interface RunEventLike {
  event?: string;
  data?: unknown;
}

export function countNewHtmlArtifacts(events: readonly RunEventLike[]): number {
  if (!events || events.length === 0) return 0;
  const writtenPaths = new Set<string>();
  for (const rec of events) {
    if (rec?.event !== 'agent') continue;
    const data = rec.data as
      | { type?: string; name?: unknown; input?: unknown }
      | null
      | undefined;
    if (data?.type !== 'tool_use') continue;
    if (typeof data.name !== 'string') continue;
    if (!WRITE_OR_EDIT_TOOL_NAMES.has(data.name)) continue;
    const path = extractToolFilePath(data.input);
    if (!path) continue;
    if (!isHtmlPath(path)) continue;
    writtenPaths.add(path);
  }
  return writtenPaths.size;
}
