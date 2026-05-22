import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

describe('new project modal layout styles', () => {
  it('keeps the form body as the remaining-height scroll region', () => {
    const css = readFileSync(join(process.cwd(), 'src/index.css'), 'utf8');

    expect(css).toContain('.newproj-body');
    expect(css).toContain('flex: 1 1 auto;');
    expect(css).toContain('overflow-y: auto;');
  });
});
