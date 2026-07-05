// Standard Expo monorepo metro config: @pattern-studio/core is installed as a
// "file:../shared-core" link, so Metro must (a) watch the linked folder for
// changes and (b) resolve both the package itself and any modules it imports
// (zustand) from this app's node_modules.
const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, "..");
const sharedCore = path.resolve(workspaceRoot, "shared-core");

const config = getDefaultConfig(projectRoot);

// 1. Watch the shared package so edits there trigger rebuilds.
config.watchFolders = [sharedCore];

// 2. Resolve dependencies of the symlinked package from the app's
//    node_modules (shared-core has no node_modules of its own).
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(sharedCore, "node_modules"),
];

// 3. Make sure the package name always resolves to the linked folder.
config.resolver.extraNodeModules = {
  "@pattern-studio/core": sharedCore,
};

// 4. The repo root has an unrelated node_modules (web app tooling) containing
//    another copy of react. Disable hierarchical lookup so Metro only uses the
//    paths above and the app bundles exactly one react instance.
config.resolver.disableHierarchicalLookup = true;

module.exports = config;
