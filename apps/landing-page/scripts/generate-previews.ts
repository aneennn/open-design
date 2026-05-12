/*
 * One-shot preview generator for the landing page.
 *
 * Walks every renderable artifact in the repo and saves a thumbnail
 * to `apps/landing-page/public/previews/<bucket>/<slug>.webp`:
 *
 *   skills/<slug>/example.html               → /previews/skills/<slug>.webp
 *   templates/live-artifacts/<slug>/index.html → /previews/templates/live-<slug>.webp
 *   templates/live-artifacts/<slug>/preview.png → reused verbatim where it exists
 *
 * Run with: `pnpm --filter @open-design/landing-page previews`
 *
 * Outputs are intentionally NOT committed by this script — the caller
 * decides whether to commit (small, deterministic) or upload to R2
 * (lighter repo, faster CDN). The catalog data layer auto-detects
 * presence at build time so missing previews degrade silently.
 *
 * Defaults: 1440×900 viewport, captured viewport-only (no full-page
 * scroll) at scale=1, then converted to 1280-wide WebP at quality 80
 * by the `sharp` post-processor below.
 */
import { chromium, type Browser } from 'playwright';
import { mkdir, cp, readdir, readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const LANDING_ROOT = path.resolve(HERE, '..');
const REPO_ROOT = path.resolve(LANDING_ROOT, '../..');
const SKILLS_DIR = path.join(REPO_ROOT, 'skills');
const TEMPLATES_DIR = path.join(REPO_ROOT, 'templates/live-artifacts');
const OUT_DIR = path.join(LANDING_ROOT, 'public/previews');

const VIEWPORT = { width: 1440, height: 900 } as const;
const SETTLE_MS = 800; // wait after `load` for fonts / R2 images / JS

interface Job {
  bucket: 'skills' | 'templates';
  slug: string;
  htmlPath: string;
  /** Optional ready-made preview to copy verbatim (skips browser). */
  reuseFrom?: string;
  /**
   * Optional inline HTML to render via `page.setContent` instead of
   * loading `htmlPath`. Used for the frontmatter-driven placeholder
   * fallback when a skill ships no `example.html`.
   */
  inlineHtml?: string;
}

interface SkillMeta {
  name: string;
  description: string;
  mode?: string;
  scenario?: string;
  surface?: string;
}

/**
 * Lightweight YAML-frontmatter extraction. We deliberately do not pull in
 * a full YAML parser: every field this generator needs is a plain scalar
 * (top-level `name`, `description`, or one nested level under `od:`),
 * and each one fits a one-line regex. Bringing in `yaml`/`gray-matter`
 * here would expand the deploy job's dependency surface for an
 * 80-line code path.
 */
async function parseSkillMeta(skillDir: string): Promise<SkillMeta> {
  const slug = path.basename(skillDir);
  const skillMd = path.join(skillDir, 'SKILL.md');
  const fallback: SkillMeta = { name: slug, description: '' };
  if (!existsSync(skillMd)) return fallback;

  const raw = await readFile(skillMd, 'utf8');
  const fmMatch = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!fmMatch) return fallback;
  const fm = fmMatch[1] ?? '';

  const stripQuotes = (s: string): string =>
    s.trim().replace(/^['"]|['"]$/g, '');
  const top = (key: string): string | undefined => {
    // `^name: value` at column 0 — only top-level fields, not nested.
    const m = fm.match(new RegExp(`^${key}:\\s*(.+?)\\s*$`, 'm'));
    return m ? stripQuotes(m[1] ?? '') : undefined;
  };
  const odField = (key: string): string | undefined => {
    // `^od:` block, then `  key: value` two-space-indented one level deep.
    const m = fm.match(new RegExp(`^od:[\\s\\S]*?^  ${key}:\\s*(.+?)\\s*$`, 'm'));
    return m ? stripQuotes(m[1] ?? '') : undefined;
  };

  return {
    name: top('name') ?? slug,
    description: top('description') ?? '',
    mode: odField('mode'),
    scenario: odField('scenario'),
    surface: odField('surface'),
  };
}

/**
 * Render a self-contained 1440×900 HTML placeholder for a skill that ships
 * no `example.html`. Uses the landing page's editorial palette so these
 * thumbnails read as part of the catalog rather than a debug fallback,
 * but stays clearly distinct from a real example via the "Skill" eyebrow
 * and lack of any rendered output.
 */
function renderFallbackHtml(meta: SkillMeta): string {
  const escape = (s: string): string =>
    s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');

  // The `description` field tends to be a long paragraph stuffed with
  // trigger phrases; clip to keep the placeholder legible at thumbnail
  // sizes. Hard cap on character count, then break at the nearest
  // sentence boundary so we don't clip mid-word.
  const fullDesc = meta.description.replace(/\s+/g, ' ').trim();
  const CAP = 220;
  let desc = fullDesc;
  if (desc.length > CAP) {
    const window = desc.slice(0, CAP);
    const cut = Math.max(window.lastIndexOf('. '), window.lastIndexOf('. '));
    desc = (cut > 80 ? window.slice(0, cut + 1) : window.trimEnd() + '…').trim();
  }

  const chips: string[] = [];
  if (meta.mode) chips.push(meta.mode);
  if (meta.scenario && meta.scenario !== meta.mode) chips.push(meta.scenario);
  if (meta.surface && meta.surface !== meta.mode && meta.surface !== meta.scenario) {
    chips.push(meta.surface);
  }
  const chipsHtml = chips
    .map((c) => `<span class="chip">${escape(c)}</span>`)
    .join('');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>${escape(meta.name)}</title>
<style>
  :root {
    --ink: #14110b;
    --paper: #efe7d2;
    --paper-deep: #d8cfb6;
    --coral: #ed6f5c;
    --ink-faint: rgba(20, 17, 11, 0.55);
  }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: 1440px; height: 900px; }
  body {
    font-family: 'Times New Roman', ui-serif, Georgia, serif;
    background: linear-gradient(135deg, var(--paper) 0%, var(--paper-deep) 100%);
    color: var(--ink);
    display: flex;
    align-items: center;
    justify-content: flex-start;
    position: relative;
    overflow: hidden;
  }
  .frame { padding: 96px 120px; max-width: 1200px; }
  .eyebrow {
    font-family: ui-sans-serif, system-ui, -apple-system, sans-serif;
    font-size: 14px;
    letter-spacing: 0.22em;
    text-transform: uppercase;
    color: var(--coral);
    margin-bottom: 40px;
  }
  .title {
    font-size: 104px;
    line-height: 1.02;
    font-weight: 600;
    letter-spacing: -0.025em;
    margin-bottom: 32px;
    word-break: break-word;
  }
  .desc {
    font-family: ui-sans-serif, system-ui, -apple-system, sans-serif;
    font-size: 26px;
    line-height: 1.45;
    color: var(--ink-faint);
    max-width: 920px;
    margin-bottom: 48px;
  }
  .chips { display: flex; gap: 14px; flex-wrap: wrap; }
  .chip {
    font-family: ui-sans-serif, system-ui, -apple-system, sans-serif;
    font-size: 13px;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    padding: 9px 18px;
    border: 1px solid var(--ink);
    border-radius: 999px;
    color: var(--ink);
    background: rgba(255, 255, 255, 0.25);
  }
  .brand {
    position: absolute;
    top: 60px;
    right: 80px;
    font-family: ui-sans-serif, system-ui, -apple-system, sans-serif;
    font-size: 12px;
    letter-spacing: 0.22em;
    text-transform: uppercase;
    color: var(--ink-faint);
  }
</style>
</head>
<body>
  <div class="brand">Open Design · Skill</div>
  <div class="frame">
    <div class="eyebrow">Skill</div>
    <h1 class="title">${escape(meta.name)}</h1>
    ${desc ? `<p class="desc">${escape(desc)}</p>` : ''}
    ${chipsHtml ? `<div class="chips">${chipsHtml}</div>` : ''}
  </div>
</body>
</html>`;
}

async function discoverJobs(): Promise<Job[]> {
  const jobs: Job[] = [];

  const skillEntries = await readdir(SKILLS_DIR, { withFileTypes: true });
  for (const entry of skillEntries) {
    if (!entry.isDirectory()) continue;
    const skillDir = path.join(SKILLS_DIR, entry.name);
    const example = path.join(skillDir, 'example.html');
    if (existsSync(example)) {
      jobs.push({
        bucket: 'skills',
        slug: entry.name,
        htmlPath: example,
      });
      continue;
    }
    // Fallback: synthesize a frontmatter-driven placeholder so every skill
    // listed in the catalog gets *something* in `/previews/skills/`. Real
    // example.html files always win when present; this only fills the gap.
    const meta = await parseSkillMeta(skillDir);
    jobs.push({
      bucket: 'skills',
      slug: entry.name,
      htmlPath: skillDir, // unused for inline jobs but preserves type shape
      inlineHtml: renderFallbackHtml(meta),
    });
  }

  if (existsSync(TEMPLATES_DIR)) {
    const templateEntries = await readdir(TEMPLATES_DIR, { withFileTypes: true });
    for (const entry of templateEntries) {
      if (!entry.isDirectory()) continue;
      const dir = path.join(TEMPLATES_DIR, entry.name);
      const index = path.join(dir, 'index.html');
      const ready = path.join(dir, 'preview.png');
      const slug = `live-${entry.name}`;
      if (existsSync(ready)) {
        jobs.push({
          bucket: 'templates',
          slug,
          htmlPath: index,
          reuseFrom: ready,
        });
      } else if (existsSync(index)) {
        jobs.push({
          bucket: 'templates',
          slug,
          htmlPath: index,
        });
      }
    }
  }

  return jobs;
}

async function captureOne(browser: Browser, job: Job): Promise<{
  ok: boolean;
  bytes: number;
  source: 'reuse' | 'render' | 'fallback';
  error?: string;
}> {
  const targetDir = path.join(OUT_DIR, job.bucket);
  await mkdir(targetDir, { recursive: true });
  const targetPng = path.join(targetDir, `${job.slug}.png`);

  if (job.reuseFrom) {
    await cp(job.reuseFrom, targetPng);
    const s = await stat(targetPng);
    return { ok: true, bytes: s.size, source: 'reuse' };
  }

  const ctx = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: 2,
  });
  const page = await ctx.newPage();
  try {
    if (job.inlineHtml) {
      // Self-contained HTML — no external resources to wait on.
      await page.setContent(job.inlineHtml, { waitUntil: 'load', timeout: 15000 });
    } else {
      await page.goto(pathToFileURL(job.htmlPath).toString(), {
        waitUntil: 'load',
        timeout: 15000,
      });
    }
    await page.waitForTimeout(SETTLE_MS);
    await page.screenshot({
      path: targetPng,
      type: 'png',
      fullPage: false,
      clip: { x: 0, y: 0, width: VIEWPORT.width, height: VIEWPORT.height },
    });
    const s = await stat(targetPng);
    return { ok: true, bytes: s.size, source: job.inlineHtml ? 'fallback' : 'render' };
  } catch (err) {
    return {
      ok: false,
      bytes: 0,
      source: job.inlineHtml ? 'fallback' : 'render',
      error: err instanceof Error ? err.message : String(err),
    };
  } finally {
    await ctx.close();
  }
}

// Exit codes used by main():
//   0 — at least one preview was produced (or there was nothing to do).
//   1 — discovery / browser launch failure, OR every job in a non-empty
//       run failed (systemic issue — workflows must surface this).
//
// Per-artifact failures alone do NOT exit non-zero. A single broken
// `example.html` should never block a deploy that successfully renders
// the other 100+ previews. CI workflows therefore do NOT need
// `continue-on-error: true` on this step — a non-zero exit here means
// something is genuinely wrong and the build should stop.
const EXIT_OK = 0;
const EXIT_SYSTEMIC = 1;

async function main(): Promise<number> {
  let jobs: Job[];
  try {
    jobs = await discoverJobs();
  } catch (err) {
    console.error(`✗ discoverJobs failed: ${err instanceof Error ? err.message : String(err)}`);
    return EXIT_SYSTEMIC;
  }

  // Allow a single arg `--only=<substring>` to subset for fast iteration.
  const only = process.argv.find((a) => a.startsWith('--only='))?.slice('--only='.length);
  const filtered = only ? jobs.filter((j) => j.slug.includes(only)) : jobs;

  console.log(`Generating ${filtered.length} previews → ${path.relative(REPO_ROOT, OUT_DIR)}/`);

  if (filtered.length === 0) {
    // Nothing to do — empty repo, or `--only=` matched nothing. Exit
    // clean so CI doesn't fail a deploy that legitimately has no
    // previews to render (e.g., on an early scaffold where no skill
    // ships an `example.html` yet).
    return EXIT_OK;
  }

  await mkdir(OUT_DIR, { recursive: true });

  let browser: Browser;
  try {
    browser = await chromium.launch({ headless: true });
  } catch (err) {
    console.error(`✗ chromium.launch failed: ${err instanceof Error ? err.message : String(err)}`);
    console.error('  Hint: in CI, ensure `playwright install --with-deps chromium` has run.');
    return EXIT_SYSTEMIC;
  }

  let ok = 0;
  let failed = 0;
  let bytes = 0;
  const reused: string[] = [];
  const fallbacks: string[] = [];
  const errors: { slug: string; error: string }[] = [];

  // Concurrency limit — 4 contexts at once is plenty for this workload
  // and keeps total RAM under ~1.5GB.
  const CONCURRENCY = 4;
  let cursor = 0;
  try {
    await Promise.all(
      Array.from({ length: CONCURRENCY }, async () => {
        while (cursor < filtered.length) {
          const idx = cursor++;
          const job = filtered[idx];
          if (!job) break;
          const result = await captureOne(browser, job);
          if (result.ok) {
            ok++;
            bytes += result.bytes;
            if (result.source === 'reuse') reused.push(job.slug);
            if (result.source === 'fallback') fallbacks.push(job.slug);
            const tag =
              result.source === 'reuse'
                ? ', reused'
                : result.source === 'fallback'
                  ? ', fallback'
                  : '';
            process.stdout.write(`✓ ${job.bucket}/${job.slug} (${(result.bytes / 1024).toFixed(0)}kb${tag})\n`);
          } else {
            failed++;
            errors.push({ slug: `${job.bucket}/${job.slug}`, error: result.error ?? 'unknown' });
            process.stdout.write(`✗ ${job.bucket}/${job.slug}: ${result.error}\n`);
          }
        }
      }),
    );
  } finally {
    await browser.close();
  }

  console.log(
    `\nDone. ok=${ok} failed=${failed} reused=${reused.length} fallback=${fallbacks.length} total=${(bytes / 1024 / 1024).toFixed(1)}MB`,
  );
  if (errors.length > 0) {
    console.log('\nPer-artifact failures (deploy continues — catalog degrades gracefully for these):');
    for (const e of errors) console.log(`  ${e.slug}: ${e.error}`);
  }

  // Systemic failure: every job in a non-empty run failed. That means
  // the generator itself is broken, not just one author's example.html.
  if (filtered.length > 0 && ok === 0) {
    console.error(
      `\n✗ All ${filtered.length} preview job(s) failed — treating as systemic.`,
    );
    return EXIT_SYSTEMIC;
  }

  return EXIT_OK;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error(err);
    process.exit(EXIT_SYSTEMIC);
  });
