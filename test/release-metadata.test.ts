import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { VERSION } from '../src/version.js';

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const json = (path: string) => JSON.parse(read(path)) as Record<string, any>;

const pkg = json('package.json');
const workflows = Object.fromEntries(readdirSync(new URL('../.github/workflows/', import.meta.url)).map(file => [file, read(`.github/workflows/${file}`)]));

describe('release identity', () => {
  it('uses the service-first package name, binary and license', () => {
    expect(pkg.name).toBe('@kieksme/enhancv-mcp');
    expect(pkg.bin).toEqual({ 'enhancv-mcp': 'dist/index.js' });
    expect(pkg.license).toBe('GPL-3.0-or-later');
    expect(pkg.publishConfig).toEqual({ access: 'public', provenance: true });
    expect(pkg.repository.url).toBe('git+https://github.com/kieksme/mcp-enhancv.git');
    expect(pkg.engines.node).toBe('>=22.14.0');
    expect(read('LICENSE')).toContain('GNU GENERAL PUBLIC LICENSE');
    expect(read('LICENSE')).toContain('Version 3');
  });

  it('keeps package.json, the Release Please manifest and src/version.ts on one version', () => {
    expect(json('.release-please-manifest.json')).toEqual({ '.': pkg.version });
    expect(VERSION).toBe(pkg.version);
    expect(read('src/version.ts')).toContain('x-release-please-version');
  });

  it('configures Release Please for a single root package with plain semver tags', () => {
    const config = json('release-please-config.json');
    expect(config['release-type']).toBe('node');
    expect(config['include-v-in-tag']).toBe(false);
    expect(config['include-component-in-tag']).toBe(false);
    expect(config.packages['.']).toMatchObject({ component: 'mcp-enhancv', 'package-name': pkg.name });
    expect(config.packages['.']['extra-files']).toContainEqual({ type: 'generic', path: 'src/version.ts' });
  });

  it('pins the same pnpm version in package.json and the Dockerfile', () => {
    const fromPackage = /^pnpm@(\d+\.\d+\.\d+)$/.exec(pkg.packageManager)?.[1];
    expect(fromPackage).toBeDefined();
    expect(read('Dockerfile')).toContain(`ARG PNPM_VERSION=${fromPackage}`);
  });
});

describe('publishing pipeline', () => {
  it('publishes to npmjs.com with Trusted Publishing and to GitHub Packages without a long-lived token', () => {
    const publish = workflows['publish.yml']!;
    expect(publish).toContain('id-token: write');
    expect(publish).toContain('registry-url: https://registry.npmjs.org');
    expect(publish).toContain('--provenance');
    expect(publish).toContain('registry-url: https://npm.pkg.github.com');
    expect(publish).toContain("scope: '@kieksme'");
    expect(publish).toContain('packages: write');
    expect(publish).toContain('NPM_CONFIG_PROVENANCE');
    expect(publish).not.toContain('secrets.NPM_TOKEN');
    expect(Object.keys(workflows)).toContain('publish.yml'); // the file name is registered at npmjs.com
  });

  it('publishes a multi-arch container image with provenance and SBOM to ghcr.io', () => {
    const docker = workflows['docker-publish.yml']!;
    expect(docker).toContain('ghcr.io/${{ github.repository_owner }}/enhancv-mcp');
    expect(docker).toContain('linux/amd64,linux/arm64');
    expect(docker).toContain('provenance: mode=max');
    expect(docker).toContain('sbom: true');
    expect(docker).toContain('type=raw,value=latest');
    expect(docker).toContain('packages: write');
  });

  it('dispatches both publishers after a Release Please release', () => {
    const release = workflows['release-please.yml']!;
    expect(release).toContain('googleapis/release-please-action@v4');
    expect(release).toContain('gh workflow run publish.yml');
    expect(release).toContain('gh workflow run docker-publish.yml');
    expect(release).toContain('release-please-config.json');
  });

  it('runs the full check suite in CI with read-only permissions', () => {
    const ci = workflows['ci.yml']!;
    for (const step of ['pnpm typecheck', 'pnpm build', 'pnpm test', 'pnpm audit', 'pnpm pack:check', 'pnpm smoke:dist', 'docker build']) {
      expect(ci, step).toContain(step);
    }
    expect(ci).toMatch(/permissions:\s+contents: read/);
  });

  it('uses the npm token only in the one-time bootstrap workflow', () => {
    for (const [name, content] of Object.entries(workflows)) {
      if (name === 'npm-bootstrap.yml') continue;
      expect(content, name).not.toContain('NPM_TOKEN');
    }
    expect(workflows['npm-bootstrap.yml']).toContain('secrets.NPM_TOKEN');
  });

  it('never interpolates workflow inputs into shell scripts and never uses floating action refs', () => {
    for (const [name, content] of Object.entries(workflows)) {
      const scripts = [...content.matchAll(/run: \|?\n?([\s\S]*?)(?=\n\s{6}- |\n\s{4}\w|\n\w|$)/g)].map(match => match[1] ?? '');
      for (const script of scripts) expect(script, `${name}: ${script.slice(0, 60)}`).not.toMatch(/\$\{\{\s*inputs\./);
      for (const ref of content.matchAll(/uses: ([\w./-]+)@(\S+)/g)) {
        expect(ref[2], `${name}: ${ref[0]}`).toMatch(/^v?\d+/);
      }
    }
  });
});

describe('container image', () => {
  const dockerfile = read('Dockerfile');

  it('runs unprivileged with a health check and no baked-in secrets', () => {
    expect(dockerfile).toContain('USER node');
    expect(dockerfile).toContain('HEALTHCHECK');
    expect(dockerfile).toContain('MCP_TRANSPORT=http');
    expect(dockerfile).not.toMatch(/ENHANCV_API_KEY\s*=|MCP_HTTP_AUTH_TOKEN\s*=/);
    expect(dockerfile).toContain('org.opencontainers.image.source="https://github.com/kieksme/mcp-enhancv"');
  });

  it('keeps sources, tests and secrets out of the build context', () => {
    const ignore = read('.dockerignore');
    for (const entry of ['node_modules', '.env', 'test', 'evaluations', '.git']) expect(ignore).toContain(entry);
  });
});

describe('documentation', () => {
  it('names the published artifacts consistently', () => {
    const readme = read('README.md');
    expect(readme).toContain('https://www.npmjs.com/package/@kieksme/enhancv-mcp');
    expect(readme).toContain('ghcr.io/kieksme/enhancv-mcp');
    expect(readme).toContain('npx -y @kieksme/enhancv-mcp');
    expect(readme).toContain('npm.pkg.github.com');
    expect(read('CONTRIBUTING.md')).toContain('publish.yml');
  });

  it('documents every environment variable the server reads', () => {
    const readme = read('README.md');
    const code = ['src/config.ts', 'src/index.ts', 'src/http.ts'].map(read).join('\n');
    for (const name of new Set(code.match(/\b(?:ENHANCV|MCP)_[A-Z_]+\b/g))) expect(readme, name).toContain(name);
  });

  it('lists every registered tool in the README', () => {
    const readme = read('README.md');
    const code = ['src/tools/resumes.ts', 'src/tools/write.ts', 'src/tools/export.ts'].map(read).join('\n');
    const tools = [...code.matchAll(/'(enhancv_[a-z_]+)',\s*\{/g)].map(match => match[1]);
    expect(tools).toHaveLength(8);
    for (const tool of tools) expect(readme, tool).toContain(`\`${tool}\``);
  });
});
