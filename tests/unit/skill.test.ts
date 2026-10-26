import { createHash } from "node:crypto";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import release from "@/lib/ingest/skill-release.json";
import {
  BUNDLED_SKILL,
  SKILL_LINK,
  topicCrafterSkill,
} from "@/lib/ingest/skill-link";

import * as skill from "../../scripts/skill.mjs";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const manifest = JSON.parse(
  readFileSync(path.join(ROOT, skill.MANIFEST), "utf8"),
) as { version: string; file: string; bytes: number; sha256: string };
const zip = readFileSync(path.join(ROOT, skill.SKILL_DIR, manifest.file));

const temps: string[] = [];
/** A copy of public/skill/ and the manifest, to break in one way. */
function copyOfRepo(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "skill-check-"));
  temps.push(dir);
  cpSync(path.join(ROOT, skill.SKILL_DIR), path.join(dir, skill.SKILL_DIR), {
    recursive: true,
  });
  mkdirSync(path.join(dir, path.dirname(skill.MANIFEST)), { recursive: true });
  cpSync(path.join(ROOT, skill.MANIFEST), path.join(dir, skill.MANIFEST));
  return dir;
}

afterEach(() => {
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true });
});

describe("the bundled TopicCrafter skill", () => {
  it("agrees with its manifest", () => {
    expect(skill.checkSkill(ROOT)).toEqual([]);
  });

  it("is version 0.1.0, with the manifest's bytes and sha256", () => {
    expect(manifest.version).toBe("0.1.0");
    expect(manifest.file).toBe("TopicCrafter-v0.1.0.zip");
    expect(zip.length).toBe(manifest.bytes);
    expect(createHash("sha256").update(zip).digest("hex")).toBe(
      manifest.sha256,
    );
  });

  it("is a skill zip whose SKILL.md has the manifest's version", () => {
    const skillMd = skill.readZipEntry(zip, "topic-crafter/SKILL.md");
    expect(skillMd.toString("utf8")).toMatch(/^---\nname: topic-crafter\n/);
    expect(skill.skillVersionOf(zip)).toBe(manifest.version);
    expect(manifest.file).toBe(`TopicCrafter-v${manifest.version}.zip`);
  });

  it("reads no entry that is not in the zip", () => {
    expect(skill.readZipEntry(zip, "topic-crafter/nothing.md")).toBeUndefined();
  });
});

describe("checkSkill", () => {
  it("finds a zip that is not the one in the manifest", () => {
    const dir = copyOfRepo();
    const file = path.join(dir, skill.SKILL_DIR, manifest.file);
    writeFileSync(file, Buffer.concat([readFileSync(file), Buffer.from("x")]));
    const problems = skill.checkSkill(dir);
    expect(problems.join("\n")).toMatch(/bytes, the manifest says/);
    expect(problems.join("\n")).toMatch(/sha256/);
  });

  it("finds an old zip that sync did not remove", () => {
    const dir = copyOfRepo();
    writeFileSync(
      path.join(dir, skill.SKILL_DIR, "TopicCrafter-v0.0.1.zip"),
      zip,
    );
    expect(skill.checkSkill(dir).join("\n")).toMatch(/must hold only/);
  });

  it("finds a manifest version that the zip does not have", () => {
    const dir = copyOfRepo();
    const file = path.join(dir, skill.MANIFEST);
    const changed = {
      ...JSON.parse(readFileSync(file, "utf8")),
      version: "9.9.9",
    };
    writeFileSync(file, JSON.stringify(changed));
    expect(skill.checkSkill(dir).join("\n")).toMatch(
      /file must be TopicCrafter-v9\.9\.9\.zip[\s\S]*SKILL\.md says version/,
    );
  });

  it("finds a missing manifest", () => {
    const dir = copyOfRepo();
    rmSync(path.join(dir, skill.MANIFEST));
    expect(skill.checkSkill(dir).join("\n")).toMatch(/is missing/);
  });
});

describe("the skill link", () => {
  it("is the bundled zip, with its version, by default", () => {
    expect(BUNDLED_SKILL).toEqual({
      kind: "download",
      href: `/skill/TopicCrafter-v${release.version}.zip`,
      version: release.version,
    });
    expect(BUNDLED_SKILL).toEqual({
      kind: "download",
      href: "/skill/TopicCrafter-v0.1.0.zip",
      version: "0.1.0",
    });
    expect(topicCrafterSkill(undefined)).toEqual(BUNDLED_SKILL);
  });

  it("points at a file Next.js serves from public/", () => {
    expect(BUNDLED_SKILL.href).toBe(
      `/${path.posix.relative("public", `${skill.SKILL_DIR}/${manifest.file}`)}`,
    );
  });

  it("is the bundled zip when the setting is blank or not a web link", () => {
    for (const value of ["  ", "javascript:alert(1)", "not a url", ""])
      expect(topicCrafterSkill(value)).toEqual(BUNDLED_SKILL);
  });

  it("is an external link for an http(s) URL", () => {
    expect(topicCrafterSkill(" https://example.org/skill ")).toEqual({
      kind: "external",
      href: "https://example.org/skill",
    });
  });

  it("follows NEXT_PUBLIC_TOPICCRAFTER_SKILL_URL (unset in tests: the zip)", () => {
    expect(SKILL_LINK).toEqual(
      topicCrafterSkill(process.env.NEXT_PUBLIC_TOPICCRAFTER_SKILL_URL),
    );
  });
});
