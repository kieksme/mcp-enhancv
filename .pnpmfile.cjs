// typescript-eslint does not support TypeScript 7 yet (https://github.com/typescript-eslint/typescript-eslint/issues/10940).
// The project compiles with TypeScript 7, so give the linting toolchain its own TypeScript 6 API. Remove this hook
// once typescript-eslint supports TypeScript >= 7.1.
const LINT_TS_VERSION = '6.0.2';

function readPackage(pkg) {
  if (pkg.name === 'typescript-eslint' || pkg.name.startsWith('@typescript-eslint/')) {
    if (pkg.peerDependencies && pkg.peerDependencies.typescript) {
      delete pkg.peerDependencies.typescript;
      pkg.dependencies = { ...pkg.dependencies, typescript: LINT_TS_VERSION };
    }
  }
  return pkg;
}

module.exports = { hooks: { readPackage } };
