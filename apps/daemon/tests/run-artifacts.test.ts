// Unit coverage for `countNewHtmlArtifacts`. Pins the v2
// `run_finished.artifact_count` invariant: incremental count of
// distinct `.html` paths the run produced or modified, deduped by
// path, with Read ops never counted.
//
// `server.ts` previously emitted `artifact_count: 0` literally, which
// suppressed every dashboard tile that breaks "generation success" by
// whether an artifact landed. These tests keep the new helper honest
// for the shapes the daemon actually sees on the wire (claude-stream,
// codex, ACP/MCP proxies).

import { describe, expect, it } from 'vitest';

import { countNewHtmlArtifacts } from '../src/run-artifacts.js';

function toolUse(name: string, filePath: string, id = 'tool-1') {
  return {
    event: 'agent',
    data: {
      type: 'tool_use',
      id,
      name,
      input: { file_path: filePath },
    },
  };
}

describe('countNewHtmlArtifacts', () => {
  it('returns 0 when the run produced no events', () => {
    expect(countNewHtmlArtifacts([])).toBe(0);
  });

  it('returns 0 when no tool_use targets a .html file', () => {
    expect(
      countNewHtmlArtifacts([
        toolUse('Write', '/proj/notes.md'),
        toolUse('Edit', '/proj/styles.css'),
        toolUse('Read', '/proj/index.html'), // Read doesn't count
      ]),
    ).toBe(0);
  });

  it('counts a single Write on a .html path', () => {
    expect(
      countNewHtmlArtifacts([toolUse('Write', '/proj/index.html')]),
    ).toBe(1);
  });

  it('dedupes multiple Write/Edit ops on the same path (one artifact per file)', () => {
    expect(
      countNewHtmlArtifacts([
        toolUse('Write', '/proj/index.html', 't1'),
        toolUse('Edit', '/proj/index.html', 't2'),
        toolUse('MultiEdit', '/proj/index.html', 't3'),
      ]),
    ).toBe(1);
  });

  it('counts distinct .html paths separately', () => {
    expect(
      countNewHtmlArtifacts([
        toolUse('Write', '/proj/index.html'),
        toolUse('Write', '/proj/about.html'),
        toolUse('Write', '/proj/contact.html'),
      ]),
    ).toBe(3);
  });

  it('handles the Codex `create_file` / `str_replace_edit` aliases', () => {
    expect(
      countNewHtmlArtifacts([
        toolUse('create_file', '/proj/a.html'),
        toolUse('str_replace_edit', '/proj/b.html'),
      ]),
    ).toBe(2);
  });

  it('accepts both `file_path` and `path` input shapes', () => {
    expect(
      countNewHtmlArtifacts([
        {
          event: 'agent',
          data: {
            type: 'tool_use',
            id: 't1',
            name: 'Write',
            input: { path: '/proj/page.html' },
          },
        },
      ]),
    ).toBe(1);
  });

  it('treats .HTML / .Html case-insensitively', () => {
    expect(
      countNewHtmlArtifacts([
        toolUse('Write', '/proj/Page.HTML'),
        toolUse('Write', '/proj/Other.Html'),
      ]),
    ).toBe(2);
  });

  it('ignores non-agent events and malformed payloads', () => {
    expect(
      countNewHtmlArtifacts([
        { event: 'start', data: { runId: 'r1' } },
        { event: 'stderr', data: { chunk: 'log' } },
        { event: 'agent', data: null },
        { event: 'agent', data: { type: 'text_delta', text: 'hi' } },
        toolUse('Write', '/proj/index.html'),
      ]),
    ).toBe(1);
  });

  it('ignores Read / Grep / Bash even when their input names a .html file', () => {
    expect(
      countNewHtmlArtifacts([
        toolUse('Read', '/proj/index.html'),
        toolUse('Grep', '/proj/index.html'),
        toolUse('Bash', '/proj/index.html'),
      ]),
    ).toBe(0);
  });
});
