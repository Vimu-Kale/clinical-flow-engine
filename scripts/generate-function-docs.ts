/**
 * Regenerates the function table in `docs/expression-language.md` from the
 * registry itself, so the documentation cannot drift from the implementation.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FUNCTIONS } from '@clinical-flow/expression';

const BEGIN = '<!-- BEGIN GENERATED FUNCTIONS -->';
const END = '<!-- END GENERATED FUNCTIONS -->';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const target = join(root, 'docs', 'expression-language.md');

const rows = Object.keys(FUNCTIONS)
  .sort()
  .map((name) => {
    const spec = FUNCTIONS[name];
    if (!spec) return '';
    return `| \`${spec.signature}\` | ${spec.description} |`;
  })
  .filter(Boolean);

const table = ['| Signature | Description |', '|---|---|', ...rows].join('\n');

const source = readFileSync(target, 'utf8');
const start = source.indexOf(BEGIN);
const finish = source.indexOf(END);
if (start === -1 || finish === -1) {
  throw new Error(`Markers not found in ${target}`);
}

const updated = `${source.slice(0, start + BEGIN.length)}\n${table}\n${source.slice(finish)}`;
writeFileSync(target, updated);
console.log(`Wrote ${rows.length} functions to docs/expression-language.md`);
