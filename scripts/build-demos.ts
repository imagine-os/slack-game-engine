/**
 * Generates `public/demos/<id>/project.json`, its assets and
 * `public/demos/index.json` from the TypeScript sources in `demos/src/`.
 *
 *   npx tsx scripts/build-demos.ts          # write files
 *   npx tsx scripts/build-demos.ts --check  # exit 1 when the committed output is stale
 *
 * `generateAll()` is pure (no I/O) so tests can compare its output with the
 * committed files.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildAllDemos } from '../demos/src/index';
import type { DemoBundle, DemoIndexEntry } from '../demos/src/lib';

export const DEMOS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../public/demos');

export interface GeneratedOutput {
  bundles: DemoBundle[];
  /** Contents of `index.json`. */
  index: { demos: DemoIndexEntry[] };
  /** Every generated file: path relative to `public/demos/` → content. */
  files: Map<string, string | Uint8Array>;
}

/** Serialize a project the way it is committed. */
export function projectJson(bundle: DemoBundle): string {
  return JSON.stringify(bundle.project, null, 2) + '\n';
}

export function generateAll(): GeneratedOutput {
  const bundles = buildAllDemos();
  const files = new Map<string, string | Uint8Array>();
  for (const b of bundles) {
    files.set(`${b.id}/project.json`, projectJson(b));
    for (const [rel, content] of Object.entries(b.files)) files.set(`${b.id}/${rel}`, content);
  }
  const index = { demos: bundles.map((b) => b.entry) };
  files.set('index.json', JSON.stringify(index, null, 2) + '\n');
  return { bundles, index, files };
}

/** Compare generated output with what is on disk; returns the stale paths. */
export function stalePaths(out: GeneratedOutput, root = DEMOS_DIR): string[] {
  const stale: string[] = [];
  for (const [rel, content] of out.files) {
    const path = join(root, rel);
    if (!existsSync(path)) { stale.push(rel); continue; }
    const disk = readFileSync(path);
    const same = typeof content === 'string' ? disk.toString('utf8') === content : Buffer.compare(disk, Buffer.from(content)) === 0;
    if (!same) stale.push(rel);
  }
  return stale;
}

export function writeAll(out: GeneratedOutput, root = DEMOS_DIR): void {
  for (const b of out.bundles) {
    const dir = join(root, b.id);
    if (existsSync(dir)) rmSync(dir, { recursive: true });
  }
  for (const [rel, content] of out.files) {
    const path = join(root, rel);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content);
  }
}

const isMain = typeof process !== 'undefined' && process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMain) {
  const out = generateAll();
  if (process.argv.includes('--check')) {
    const stale = stalePaths(out);
    if (stale.length) {
      console.error(`Demo output is stale (${stale.length} file(s)). Run: npx tsx scripts/build-demos.ts\n  ` + stale.join('\n  '));
      process.exit(1);
    }
    console.log(`Demos up to date (${out.files.size} files).`);
  } else {
    writeAll(out);
    console.log(`Wrote ${out.files.size} files for ${out.bundles.length} demos to ${DEMOS_DIR}`);
    for (const b of out.bundles) console.log(`  ${b.id}: ${b.project.scenes.reduce((n, s) => n + s.entities.length, 0)} entities, ${b.project.scripts.length} scripts, ${b.project.prefabs.length} prefabs`);
  }
}
