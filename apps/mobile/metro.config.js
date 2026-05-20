const { getDefaultConfig } = require('expo/metro-config');
const path = require('node:path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '..', '..');

const config = getDefaultConfig(projectRoot);

// Watch the entire workspace so changes in packages/* hot-reload.
config.watchFolders = [workspaceRoot];

// Look in the local node_modules first, then the workspace root's.
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];

// pnpm symlinks; avoid Metro resolving the same module through two paths.
config.resolver.disableHierarchicalLookup = true;

module.exports = config;
