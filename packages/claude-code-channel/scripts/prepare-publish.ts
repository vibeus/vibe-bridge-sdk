#!/usr/bin/env bun
import { chmodSync, copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const pkgRoot = dirname(import.meta.dir);
const distDir = join(pkgRoot, "dist");
const repoRoot = join(pkgRoot, "..", "..");
const entry = join(distDir, "channel.js");

if (!existsSync(entry)) {
  throw new Error("dist/channel.js missing — run `bun run build` first.");
}

// The source ships a `#!/usr/bin/env bun` shebang for dev. The published CLI
// must run under node so `npx @vibeus/claude-code-channel` works without bun.
const before = readFileSync(entry, "utf8");
const NODE_SHEBANG = "#!/usr/bin/env node\n";
const after = before.startsWith("#!")
  ? before.replace(/^#![^\n]*\n/, NODE_SHEBANG)
  : NODE_SHEBANG + before;
if (after !== before) {
  writeFileSync(entry, after);
}
chmodSync(entry, 0o755);

const src = JSON.parse(readFileSync(join(pkgRoot, "package.json"), "utf8"));

const out = {
  name: src.name,
  version: src.version,
  description: src.description,
  license: src.license,
  type: src.type,
  engines: src.engines,
  bin: {
    "claude-code-channel": "./channel.js",
  },
  files: ["channel.js"],
  dependencies: src.dependencies,
  repository: src.repository,
  homepage: src.homepage,
  bugs: src.bugs,
  publishConfig: src.publishConfig,
};

writeFileSync(join(distDir, "package.json"), `${JSON.stringify(out, null, 2)}\n`);

for (const f of ["README.md", "LICENSE"]) {
  const srcFile = existsSync(join(pkgRoot, f)) ? join(pkgRoot, f) : join(repoRoot, f);
  if (existsSync(srcFile)) {
    copyFileSync(srcFile, join(distDir, f));
  }
}

console.log(`Prepared ${distDir} for publish (${out.name}@${out.version})`);
