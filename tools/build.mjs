/* build.mjs - validate, bump the version, stage and zip the module.
 *
 *   node tools/build.mjs                 patch bump (0.1.0 -> 0.1.1) and zip
 *   node tools/build.mjs --minor         minor bump (0.1.1 -> 0.2.0)
 *   node tools/build.mjs --major         major bump (0.2.0 -> 1.0.0)
 *   node tools/build.mjs --no-bump       package the current version as-is
 *   node tools/build.mjs --version=1.2.3 package an explicit version
 *   node tools/build.mjs --skip-checks   skip syntax checks and tests
 *
 * Every run that bumps produces a new dist/<id>-v<version>.zip, so each
 * iteration has its own artefact and its own version number. The contents sit
 * at the zip root (module.json first) because that is what Foundry installs.
 */

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifestPath = path.join(root, "module.json");
const packagePath = path.join(root, "package.json");
const distDir = path.join(root, "dist");

function fail(message) {
  console.error(`build failed: ${message}`);
  process.exit(1);
}

/* ------------------------------------------------------------- options */

let bump = "patch";
let explicit = null;
let skipChecks = false;
for (const arg of process.argv.slice(2)) {
  if (arg === "--major" || arg === "--minor" || arg === "--patch") bump = arg.slice(2);
  else if (arg === "--no-bump") bump = "none";
  else if (arg.startsWith("--version=")) {
    explicit = arg.slice("--version=".length);
    bump = "none";
  } else if (arg === "--skip-checks") skipChecks = true;
  else fail(`unknown argument ${arg}`);
}

/* ----------------------------------------------------------- versions */

function parseVersion(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(String(version));
  if (!match) fail(`"${version}" is not a major.minor.patch version`);
  return match.slice(1).map(Number);
}

function nextVersion(version, mode) {
  let [major, minor, patch] = parseVersion(version);
  if (mode === "major") {
    major += 1;
    minor = 0;
    patch = 0;
  } else if (mode === "minor") {
    minor += 1;
    patch = 0;
  } else if (mode === "patch") {
    patch += 1;
  }
  return `${major}.${minor}.${patch}`;
}

/* ------------------------------------------------------------- checks */

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (entry.isFile()) out.push(full);
  }
  return out;
}

function syntaxCheck() {
  const files = walk(path.join(root, "scripts")).filter(file => file.endsWith(".mjs"));
  if (files.length === 0) fail("no scripts to build");
  for (const file of files) {
    const result = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
    if (result.status !== 0) {
      console.error(result.stdout, result.stderr);
      fail(`syntax check failed for ${path.relative(root, file)}`);
    }
  }
  console.log(`syntax: ${files.length} scripts ok`);
}

function runTests() {
  const testDir = path.join(root, "tests");
  const files = fs.readdirSync(testDir)
    .filter(name => name.endsWith(".test.mjs"))
    .sort()
    .map(name => path.join(testDir, name));
  if (files.length === 0) fail("no tests found");
  const result = spawnSync(process.execPath, ["--test", ...files], { stdio: "inherit" });
  if (result.status !== 0) fail("tests failed");
}

/* ----------------------------------------------------------- manifest */

function readManifest() {
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  } catch (err) {
    fail(`module.json is not valid JSON: ${err.message}`);
  }
  if (!/^[a-z0-9_-]+$/.test(manifest.id ?? "")) {
    fail("module id must be lowercase letters, digits, '-' or '_' (Foundry forbids spaces)");
  }
  if (!manifest.title) fail("module.json needs a title");
  parseVersion(manifest.version);
  if (!Array.isArray(manifest.esmodules) || manifest.esmodules.length === 0) {
    fail("module.json needs at least one esmodules entry");
  }
  for (const entry of manifest.esmodules) {
    if (!fs.existsSync(path.join(root, entry))) fail(`esmodules entry does not exist: ${entry}`);
  }
  for (const language of manifest.languages ?? []) {
    if (!fs.existsSync(path.join(root, language.path))) fail(`language file does not exist: ${language.path}`);
  }
  return manifest;
}

function writeVersion(manifest, version) {
  manifest.version = version;
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  if (fs.existsSync(packagePath)) {
    const pkg = JSON.parse(fs.readFileSync(packagePath, "utf8"));
    pkg.version = version;
    fs.writeFileSync(packagePath, `${JSON.stringify(pkg, null, 2)}\n`);
  }
  console.log(`version: ${version}`);
}

/** owner/repo taken from package.json, so the release URLs stay in sync. */
function repositorySlug() {
  if (!fs.existsSync(packagePath)) return null;
  const pkg = JSON.parse(fs.readFileSync(packagePath, "utf8"));
  const raw = typeof pkg.repository === "string" ? pkg.repository : pkg.repository?.url;
  if (!raw) return null;
  const match = /github\.com[/:]([^/]+)\/([^/.#]+)/i.exec(raw);
  return match ? `${match[1]}/${match[2]}` : null;
}

/**
 * Stamp the Foundry manifest with the GitHub install URLs for this version:
 * a stable manifest URL for Foundry's installer and a versioned zip download.
 */
function applyRepositoryLinks(manifest) {
  const slug = repositorySlug();
  if (!slug) return;
  const base = `https://github.com/${slug}`;
  manifest.url = base;
  manifest.manifest = `${base}/releases/latest/download/module.json`;
  manifest.download = `${base}/releases/download/v${manifest.version}/${manifest.id}-v${manifest.version}.zip`;
  manifest.readme = `${base}#readme`;
  manifest.bugs = `${base}/issues`;
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`repository: ${slug}`);
}

/* -------------------------------------------------------------- stage */

function copy(source, destination) {
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(source, destination);
}

function stage(manifest) {
  const stageDir = path.join(distDir, manifest.id);
  fs.rmSync(stageDir, { recursive: true, force: true });
  fs.mkdirSync(stageDir, { recursive: true });

  copy(manifestPath, path.join(stageDir, "module.json"));
  for (const file of ["README.md", "LICENSE"]) {
    const source = path.join(root, file);
    if (fs.existsSync(source)) copy(source, path.join(stageDir, file));
  }
  for (const folder of ["scripts", "lang", "styles"]) {
    const sourceDir = path.join(root, folder);
    if (!fs.existsSync(sourceDir)) continue;
    for (const file of walk(sourceDir)) {
      copy(file, path.join(stageDir, path.relative(root, file)));
    }
  }
  const files = walk(stageDir);
  console.log(`staged: ${files.length} files in ${path.relative(root, stageDir)}`);
  return stageDir;
}

/* ---------------------------------------------------------------- zip */

function zip(stageDir, output) {
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.rmSync(output, { force: true });

  const python = spawnSync("python", [path.join(root, "tools", "zip.py"), stageDir, output], {
    cwd: root,
    encoding: "utf8"
  });
  if (python.status === 0) {
    process.stdout.write(python.stdout);
    return;
  }

  console.warn("python zip helper unavailable, falling back to Compress-Archive");
  const powershell = spawnSync("powershell.exe", [
    "-NoProfile",
    "-NonInteractive",
    "-Command",
    `Compress-Archive -Path '${stageDir}\\*' -DestinationPath '${output}' -Force`
  ], { encoding: "utf8" });
  if (powershell.status !== 0) {
    console.error(python.stderr, powershell.stderr);
    fail("could not create the zip");
  }
  console.log(`zip: ${fs.statSync(output).size} bytes -> ${path.relative(root, output)}`);
}

/* --------------------------------------------------------------- main */

const manifest = readManifest();
const version = explicit ?? (bump === "none" ? manifest.version : nextVersion(manifest.version, bump));
if (explicit) parseVersion(explicit);
writeVersion(manifest, version);
applyRepositoryLinks(manifest);

if (!skipChecks) {
  syntaxCheck();
  runTests();
}

const staged = stage(manifest);
const zipPath = path.join(distDir, `${manifest.id}-v${manifest.version}.zip`);
zip(staged, zipPath);

console.log("");
console.log(`built ${manifest.title} v${manifest.version}`);
console.log(`  zip     ${path.relative(root, zipPath)}`);
console.log(`  staged  ${path.relative(root, staged)}`);
console.log(`  install extract the zip into Data/modules/${manifest.id}/`);
const slug = repositorySlug();
if (slug) {
  console.log(`  release gh release create v${manifest.version} ${path.relative(root, zipPath)} ${path.relative(root, path.join(staged, "module.json"))} --title "${manifest.title} v${manifest.version}"`);
}
