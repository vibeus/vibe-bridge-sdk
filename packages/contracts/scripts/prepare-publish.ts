#!/usr/bin/env bun
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";

const pkgRoot = dirname(import.meta.dir);
const distDir = join(pkgRoot, "dist");
const repoRoot = join(pkgRoot, "..", "..");

if (!existsSync(join(distDir, "index.js")) || !existsSync(join(distDir, "index.d.ts"))) {
  throw new Error("dist/ missing build output — run `bun run build` first.");
}

// tsc's rewriteRelativeImportExtensions rewrites .ts → .js in emitted JS but
// leaves .d.ts referencing the original .ts path, which external consumers
// can't resolve. Normalize all relative imports in .d.ts files to use .js.
const tsImportRe = /(from\s+["'])(\.{1,2}\/[^"']+?)\.ts(["'])/g;
for (const f of readdirSync(distDir)) {
  if (!f.endsWith(".d.ts")) {
    continue;
  }
  const p = join(distDir, f);
  const before = readFileSync(p, "utf8");
  const after = before.replace(tsImportRe, "$1$2.js$3");
  if (before !== after) {
    writeFileSync(p, after);
  }
}

const src = JSON.parse(readFileSync(join(pkgRoot, "package.json"), "utf8"));

const out = {
  name: src.name,
  version: src.version,
  description: src.description,
  license: src.license,
  type: src.type,
  exports: {
    ".": {
      types: "./index.d.ts",
      import: "./index.js",
      default: "./index.js",
    },
    "./channel": {
      types: "./channel.d.ts",
      import: "./channel.js",
      default: "./channel.js",
    },
  },
  files: ["**/*.js", "**/*.d.ts"],
  repository: src.repository,
  homepage: src.homepage,
  bugs: src.bugs,
  publishConfig: src.publishConfig,
};

mkdirSync(distDir, { recursive: true });
writeFileSync(join(distDir, "package.json"), `${JSON.stringify(out, null, 2)}\n`);

for (const f of ["README.md", "LICENSE"]) {
  const srcFile = existsSync(join(pkgRoot, f)) ? join(pkgRoot, f) : join(repoRoot, f);
  if (existsSync(srcFile)) {
    copyFileSync(srcFile, join(distDir, f));
  }
}

console.log(`Prepared ${distDir} for publish (${out.name}@${out.version})`);
