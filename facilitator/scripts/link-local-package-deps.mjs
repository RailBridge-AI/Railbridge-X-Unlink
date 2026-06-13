import { existsSync, lstatSync, mkdirSync, readlinkSync, symlinkSync } from "node:fs";
import { rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const facilitatorRoot = resolve(__dirname, "..");
const targetNodeModules = resolve(facilitatorRoot, "node_modules");
const packagesRoot = resolve(facilitatorRoot, "..", "packages");
const linkPath = resolve(packagesRoot, "node_modules");

const logPrefix = "[local-sdk-deps]";

const normalizeResolvedPath = (value) => resolve(packagesRoot, value);

const main = async () => {
  if (!existsSync(targetNodeModules)) {
    console.warn(`${logPrefix} facilitator/node_modules not found; skipping shared packages/node_modules link`);
    return;
  }

  mkdirSync(packagesRoot, { recursive: true });

  if (existsSync(linkPath)) {
    const stats = lstatSync(linkPath);
    if (stats.isSymbolicLink()) {
      const currentTarget = normalizeResolvedPath(readlinkSync(linkPath));
      if (currentTarget === targetNodeModules) {
        console.log(`${logPrefix} packages/node_modules already points to facilitator/node_modules`);
        return;
      }
      await rm(linkPath, { recursive: true, force: true });
    } else {
      console.log(`${logPrefix} packages/node_modules already exists as a real directory; leaving it unchanged`);
      return;
    }
  }

  symlinkSync(
    targetNodeModules,
    linkPath,
    process.platform === "win32" ? "junction" : "dir",
  );
  console.log(`${logPrefix} linked packages/node_modules -> facilitator/node_modules`);
};

main().catch((error) => {
  console.error(`${logPrefix} failed to link shared package dependencies`);
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
