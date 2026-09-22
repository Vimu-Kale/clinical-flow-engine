/**
 * Static safety gate for every pathway in `pathways/`.
 *
 * CI runs this before the test suite. A definition that cannot be parsed, or
 * that fails any structural or semantic rule, fails the build — the point being
 * that an unsafe pathway should never reach a reviewer, let alone a patient.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { safeParseWorkflow, validateWorkflow, type ValidationIssue } from '@clinical-flow/workflow-core';

const ESC = String.fromCharCode(27);
const DIM = `${ESC}[2m`;
const RED = `${ESC}[31m`;
const YELLOW = `${ESC}[33m`;
const GREEN = `${ESC}[32m`;
const BOLD = `${ESC}[1m`;
const RESET = `${ESC}[0m`;

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pathwaysDir = join(root, 'pathways');

function describe(issue: ValidationIssue): string {
  const location = [issue.nodeId, issue.edgeId, issue.field].filter(Boolean).join(' · ');
  return location ? `${issue.message} ${DIM}(${location})${RESET}` : issue.message;
}

let totalErrors = 0;
let totalWarnings = 0;

const files = readdirSync(pathwaysDir)
  .filter((name) => name.endsWith('.json'))
  .sort();

if (files.length === 0) {
  console.error(`${RED}No pathway definitions found in ${pathwaysDir}${RESET}`);
  process.exit(1);
}

console.log(`${BOLD}Validating ${files.length} pathway definitions${RESET}\n`);

for (const file of files) {
  const raw: unknown = JSON.parse(readFileSync(join(pathwaysDir, file), 'utf8'));
  const parsed = safeParseWorkflow(raw);

  if (!parsed.success) {
    totalErrors += parsed.error.issues.length;
    console.log(`${RED}FAIL${RESET} ${BOLD}${file}${RESET} — does not match the schema`);
    for (const issue of parsed.error.issues) {
      console.log(`    ${RED}schema${RESET}  ${issue.path.join('.') || '(root)'}: ${issue.message}`);
    }
    console.log();
    continue;
  }

  const definition = parsed.data;
  const result = validateWorkflow(definition);
  totalErrors += result.errors.length;
  totalWarnings += result.warnings.length;

  const mark = result.valid ? `${GREEN}PASS${RESET}` : `${RED}FAIL${RESET}`;
  const counts = `${definition.nodes.length} nodes, ${definition.edges.length} edges`;
  console.log(`${mark} ${BOLD}${definition.name}${RESET} ${DIM}v${definition.version} · ${counts} · ${file}${RESET}`);

  for (const issue of result.errors) {
    console.log(`    ${RED}error${RESET}   ${describe(issue)}`);
  }
  for (const issue of result.warnings) {
    console.log(`    ${YELLOW}warning${RESET} ${describe(issue)}`);
  }
}

console.log();
if (totalErrors > 0) {
  console.log(`${RED}${BOLD}Failed:${RESET} ${totalErrors} error(s), ${totalWarnings} warning(s).`);
  process.exit(1);
}
console.log(`${GREEN}${BOLD}All pathways passed${RESET} — 0 errors, ${totalWarnings} warning(s).`);
