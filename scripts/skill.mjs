#!/usr/bin/env node
/**
 * The TopicCrafter skill zip that Ingester mode offers for download (public/skill/, served by
 * Next.js as /skill/<file>). No dependencies: Node built-ins only. Ported from topic-ingester.
 *
 *   node scripts/skill.mjs sync     # copy a new build from $QUESTIONCRAFTER_AGENT_DIR/skills/TopicCrafter.zip
 *   node scripts/skill.mjs check    # exit status 1 when public/skill/ and the manifest do not agree
 *
 * `sync` reads the version from SKILL.md in the zip (`metadata.version`), writes
 * public/skill/TopicCrafter-v<version>.zip, removes the old zips there, and writes the manifest
 * src/lib/ingest/skill-release.json (version, file, bytes, sha256, the backend commit of the zip),
 * which src/lib/ingest/skill-link.ts reads for the download link.
 *
 * `check` is in the gate. It needs no backend: the manifest names one zip in public/skill/, the bytes and
 * the sha256 agree, the file name has the version, and SKILL.md in the zip has the same version. When
 * QUESTIONCRAFTER_AGENT_DIR is set and its zip is different, it prints a warning (not a failure: that
 * checkout can be on another branch).
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { inflateRawSync } from "node:zlib";

export const SKILL_DIR = "public/skill";
export const MANIFEST = "src/lib/ingest/skill-release.json";
const SOURCE = "skills/TopicCrafter.zip";
const SKILL_MD = "topic-crafter/SKILL.md";
const VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

// ------------------------------------------------------------------ Zip reading

/** The bytes of one entry of a zip (stored or deflated), or undefined when the zip has no such entry. */
export function readZipEntry(zip, name) {
  const eocd = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (eocd < 0) throw new Error("not a zip file");
  const count = zip.readUInt16LE(eocd + 10);
  let at = zip.readUInt32LE(eocd + 16);
  for (let i = 0; i < count; i++) {
    if (zip.readUInt32LE(at) !== 0x02014b50)
      throw new Error("broken zip directory");
    const method = zip.readUInt16LE(at + 10);
    const size = zip.readUInt32LE(at + 20);
    const nameLength = zip.readUInt16LE(at + 28);
    const skip =
      nameLength + zip.readUInt16LE(at + 30) + zip.readUInt16LE(at + 32);
    const local = zip.readUInt32LE(at + 42);
    if (zip.toString("utf8", at + 46, at + 46 + nameLength) === name) {
      const start =
        local +
        30 +
        zip.readUInt16LE(local + 26) +
        zip.readUInt16LE(local + 28);
      const data = zip.subarray(start, start + size);
      if (method === 0) return data;
      if (method === 8) return inflateRawSync(data);
      throw new Error(`zip method ${method} is not supported`);
    }
    at += 46 + skip;
  }
  return undefined;
}

/** `metadata.version` of the frontmatter of SKILL.md in the skill zip. */
export function skillVersionOf(zip) {
  const skillMd = readZipEntry(zip, SKILL_MD);
  if (!skillMd) throw new Error(`the zip has no ${SKILL_MD}`);
  const front = /^---\n([\s\S]*?)\n---\n/.exec(skillMd.toString("utf8"));
  const block = front && /^metadata:\n((?:[ \t]+.*\n?)*)/m.exec(front[1]);
  const version =
    block && /^[ \t]+version:\s*["']?([^"'\s]+)["']?\s*$/m.exec(block[1]);
  if (!version || !VERSION.test(version[1]))
    throw new Error(`${SKILL_MD} has no metadata.version like "0.1.0"`);
  return version[1];
}

export const fileNameFor = (version) => `TopicCrafter-v${version}.zip`;
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

// ------------------------------------------------------------------ Check

/** The problems of public/skill/ and the manifest, as sentences. Empty when they agree. */
export function checkSkill(root) {
  const manifestPath = path.join(root, MANIFEST);
  if (!existsSync(manifestPath))
    return [`${MANIFEST} is missing: run pnpm skill:sync`];
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const problems = [];
  if (!VERSION.test(manifest.version ?? ""))
    problems.push(`${MANIFEST}: version must be like "0.1.0"`);
  if (manifest.file !== fileNameFor(manifest.version))
    problems.push(`${MANIFEST}: file must be ${fileNameFor(manifest.version)}`);
  const dir = path.join(root, SKILL_DIR);
  const zips = existsSync(dir)
    ? readdirSync(dir).filter((f) => f.endsWith(".zip"))
    : [];
  if (zips.length !== 1 || zips[0] !== manifest.file)
    problems.push(
      `${SKILL_DIR}/ must hold only ${manifest.file} (it holds: ${zips.join(", ") || "nothing"})`,
    );
  const zipPath = path.join(dir, manifest.file ?? "");
  if (!existsSync(zipPath)) return problems;
  const zip = readFileSync(zipPath);
  if (zip.length !== manifest.bytes)
    problems.push(
      `${manifest.file}: ${zip.length} bytes, the manifest says ${manifest.bytes}`,
    );
  if (sha256(zip) !== manifest.sha256)
    problems.push(
      `${manifest.file}: the sha256 is not the one in the manifest`,
    );
  try {
    const inZip = skillVersionOf(zip);
    if (inZip !== manifest.version)
      problems.push(
        `${manifest.file}: SKILL.md says version ${inZip}, the manifest says ${manifest.version}`,
      );
  } catch (error) {
    problems.push(`${manifest.file}: ${error.message}`);
  }
  return problems;
}

/** A warning when the backend checkout has a different zip, else undefined. */
function backendDrift(root, backendDir) {
  const source = path.join(backendDir, SOURCE);
  if (!existsSync(source)) return `no ${SOURCE} in QUESTIONCRAFTER_AGENT_DIR`;
  const manifest = JSON.parse(readFileSync(path.join(root, MANIFEST), "utf8"));
  const zip = readFileSync(source);
  if (sha256(zip) === manifest.sha256) return undefined;
  let version = "?";
  try {
    version = skillVersionOf(zip);
  } catch {
    // An old build without a version: the warning still says that it is different.
  }
  return `the backend's ${SOURCE} (version ${version}) is not the one in ${SKILL_DIR}/ (version ${manifest.version}). If it is newer, run pnpm skill:sync`;
}

// ------------------------------------------------------------------ Sync

function gitOut(dir, args) {
  try {
    return execFileSync("git", ["-C", dir, ...args], {
      encoding: "utf8",
    }).trim();
  } catch {
    return "";
  }
}

export function syncSkill(root, backendDir) {
  const source = path.join(backendDir, SOURCE);
  if (!existsSync(source)) throw new Error(`no ${SOURCE} in ${backendDir}`);
  const zip = readFileSync(source);
  const version = skillVersionOf(zip);
  const file = fileNameFor(version);
  const dir = path.join(root, SKILL_DIR);
  mkdirSync(dir, { recursive: true });
  for (const old of readdirSync(dir).filter(
    (f) => f.endsWith(".zip") && f !== file,
  ))
    rmSync(path.join(dir, old));
  writeFileSync(path.join(dir, file), zip);
  const manifest = {
    version,
    file,
    bytes: zip.length,
    sha256: sha256(zip),
    source: {
      repository: "DevOpRohan/QuestionCrafterAgent",
      path: SOURCE,
      commit: gitOut(backendDir, ["log", "-1", "--format=%H", "--", SOURCE]),
    },
  };
  writeFileSync(
    path.join(root, MANIFEST),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  const uncommitted =
    gitOut(backendDir, ["status", "--porcelain", "--", SOURCE]) !== "";
  return { manifest, uncommitted };
}

// ------------------------------------------------------------------ CLI

function main(argv) {
  const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
  const backendDir = process.env.QUESTIONCRAFTER_AGENT_DIR;
  if (argv[0] === "sync") {
    if (!backendDir) {
      console.error(
        "Set QUESTIONCRAFTER_AGENT_DIR to a checkout of the backend (QuestionCrafterAgent).",
      );
      return 1;
    }
    const { manifest, uncommitted } = syncSkill(root, path.resolve(backendDir));
    console.log(
      `Wrote ${SKILL_DIR}/${manifest.file} (version ${manifest.version}, ${manifest.bytes} bytes) and ${MANIFEST}.`,
    );
    if (uncommitted)
      console.warn(
        `Warning: ${SOURCE} has changes that are not committed in the backend. Commit them there first.`,
      );
    return 0;
  }
  if (argv[0] === "check") {
    const problems = checkSkill(root);
    for (const problem of problems) console.error(`skill: ${problem}`);
    if (problems.length) return 1;
    const drift = backendDir
      ? backendDrift(root, path.resolve(backendDir))
      : undefined;
    if (drift) console.warn(`skill: warning: ${drift}`);
    const { version, file } = JSON.parse(
      readFileSync(path.join(root, MANIFEST), "utf8"),
    );
    console.log(
      `skill: ${SKILL_DIR}/${file} is version ${version} and agrees with ${MANIFEST}.`,
    );
    return 0;
  }
  console.error("Usage: node scripts/skill.mjs sync | check");
  return 2;
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  process.exitCode = main(process.argv.slice(2));
