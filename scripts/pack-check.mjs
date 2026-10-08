#!/usr/bin/env node
/**
 * Verifies what `npm publish` would ship, without writing a tarball: the compiled server and the legal/docs
 * files must be present; sources, tests, evaluations, workflows and local secrets must not be.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

const output = execFileSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });
const [report] = JSON.parse(output);
const files = report.files.map(file => file.path);

const failures = [];
const required = ['package.json', 'README.md', 'LICENSE', 'SECURITY.md', 'dist/index.js', 'dist/server.js', 'dist/http.js'];
for (const path of required) if (!files.includes(path)) failures.push(`missing from the package: ${path}`);

const forbidden = [/^src\//, /^test\//, /^evaluations\//, /^scripts\//, /^\.github\//, /^\.env/, /^Dockerfile/, /^docker-compose/, /\.test\.(js|d\.ts)$/, /tsconfig/, /^pnpm-lock/];
for (const path of files) {
  if (forbidden.some(pattern => pattern.test(path))) failures.push(`must not be published: ${path}`);
}

const entry = readFileSync(join(root, 'dist/index.js'), 'utf8');
if (!entry.startsWith('#!/usr/bin/env node')) failures.push('dist/index.js must start with the node shebang (bin entry)');
if (pkg.bin?.['enhancv-mcp'] !== 'dist/index.js') failures.push('package.json bin must point to dist/index.js');
if (report.size > 1024 * 1024) failures.push(`package is unexpectedly large: ${report.size} bytes`);

if (failures.length) {
  console.error(`pack:check failed for ${pkg.name}@${pkg.version}:\n- ${failures.join('\n- ')}`);
  process.exit(1);
}
console.log(`pack:check ok: ${pkg.name}@${pkg.version}, ${files.length} files, ${report.size} bytes packed`);
