/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Stages onnxruntime-node into apps/desktop/onnxruntime/node_modules so
// electron-forge can ship it as an app resource. Two facts force this script
// to exist:
//
//   1. onnxruntime-node loads a `.node` addon at runtime, so build:main marks
//      it `--external` and dist/main.js `require`s it by name at startup. A
//      packaged app has to carry the real package on disk.
//   2. npm hoists it to the repo-root node_modules, which is outside the
//      directory electron-forge packages, and the whole package is 259 MB
//      because it carries every platform's binaries.
//
// The staged layout is a node_modules directory verbatim, because that is what
// makes the copy resolvable: extraResource drops it at Contents/Resources/
// node_modules, and Node's lookup from Contents/Resources/app/dist/main.js
// walks up through exactly that path. Staging it here rather than into
// apps/desktop/node_modules also keeps a stale or half-copied stage from
// shadowing the real package in dev.
//
// Only the current platform+arch binaries are copied (~39 MB on darwin/arm64),
// plus the pure-JS onnxruntime-common that dist/binding.js requires. The
// package's own dependencies (adm-zip, global-agent) are postinstall-only —
// nothing under dist/ requires them.

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const desktopDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const stageDir = join(desktopDir, "onnxruntime", "node_modules");

const nodeSrc = dirname(require.resolve("onnxruntime-node/package.json"));
// onnxruntime-common declares `exports` without a "./package.json" entry, so it
// cannot be resolved by subpath; find it where npm actually puts it instead —
// nested under onnxruntime-node when versions conflict, hoisted as a sibling
// otherwise.
const commonSrc = [join(nodeSrc, "node_modules", "onnxruntime-common"), join(nodeSrc, "..", "onnxruntime-common")].find(
  (dir) => existsSync(join(dir, "package.json")),
);
if (!commonSrc) throw new Error("stage-onnxruntime: cannot find onnxruntime-common next to onnxruntime-node");

// napi-v6 is the only ABI the package builds; see its package.json `binary`.
const binSrc = join(nodeSrc, "bin", "napi-v6", process.platform, process.arch);
if (!existsSync(binSrc)) {
  // 1.27.0 ships darwin/arm64 but no darwin/x64, so this is reachable on Intel
  // Macs. Fail the build rather than package an app whose `dapi media matte`
  // dies with "Cannot find module" the first time a user runs it.
  throw new Error(`stage-onnxruntime: onnxruntime-node has no binaries for ${process.platform}/${process.arch}`);
}

rmSync(join(desktopDir, "onnxruntime"), { recursive: true, force: true });

const nodeDst = join(stageDir, "onnxruntime-node");
// dist/binding.js requires the addon at this exact relative path, so the
// stage has to reproduce it: ../bin/napi-v6/${platform}/${arch}.
const binDst = join(nodeDst, "bin", "napi-v6", process.platform, process.arch);
mkdirSync(binDst, { recursive: true });

cpSync(join(nodeSrc, "package.json"), join(nodeDst, "package.json"));
cpSync(join(nodeSrc, "README.md"), join(nodeDst, "README.md"));
// .d.ts and .js.map are dev-only; dist/*.js is the whole runtime.
cpSync(join(nodeSrc, "dist"), join(nodeDst, "dist"), {
  recursive: true,
  filter: (src) => statSync(src).isDirectory() || (src.endsWith(".js") && !src.endsWith(".js.map")),
});

// darwin ships libonnxruntime.1.dylib and libonnxruntime.1.27.0.dylib as two
// byte-identical 38.8 MB copies (both carry install name @rpath/
// libonnxruntime.1.dylib). Keep one and symlink the duplicates at it: 38.8 MB
// saved, and the shorter name stays the real file because that is the soname
// the addon's load command asks for.
const kept = new Map();
for (const name of readdirSync(binSrc).sort((a, b) => a.length - b.length || a.localeCompare(b))) {
  const digest = createHash("sha256").update(readFileSync(join(binSrc, name))).digest("hex");
  const original = kept.get(digest);
  if (original) symlinkSync(original, join(binDst, name));
  else {
    cpSync(join(binSrc, name), join(binDst, name));
    kept.set(digest, name);
  }
}

const commonDst = join(stageDir, "onnxruntime-common");
mkdirSync(commonDst, { recursive: true });
cpSync(join(commonSrc, "package.json"), join(commonDst, "package.json"));
cpSync(join(commonSrc, "README.md"), join(commonDst, "README.md"));
// dist/esm is unreachable: main.ts is bundled to CJS, so the `exports` map
// always takes the "require" branch into dist/cjs.
cpSync(join(commonSrc, "dist", "cjs"), join(commonDst, "dist", "cjs"), { recursive: true });

// Same trap stage-cli.mjs records: Mach-O files under Resources are not
// reliably reached by the app-bundle signing pass, and notarization rejects
// unsigned executables. Signing here is idempotent — forge re-signs with
// --force if it does see them.
if (process.platform === "darwin" && !process.env.SKIP_SIGN) {
  const identities = execFileSync("security", ["find-identity", "-v", "-p", "codesigning"], { encoding: "utf8" });
  const identity = identities.match(/"(Developer ID Application: [^"]+)"/)?.[1];
  if (identity) {
    for (const [, name] of kept) {
      execFileSync(
        "codesign",
        ["--force", "--options", "runtime", "--timestamp", "--sign", identity, join(binDst, name)],
        { stdio: "inherit" },
      );
    }
  } else {
    console.warn("stage-onnxruntime: no Developer ID identity found, leaving native binaries unsigned");
  }
}

console.log(`stage-onnxruntime: staged onnxruntime-node (${process.platform}/${process.arch}) at ${stageDir}`);
