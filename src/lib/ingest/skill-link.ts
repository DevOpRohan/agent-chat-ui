/**
 * The "TopicCrafter skill" link of Ingester's "New here?" panel.
 *
 * By default it is the zip in public/skill/ (served by Next.js at /skill/<file>) that
 * `pnpm skill:sync` copied from the backend, with its version, as named in skill-release.json.
 * `pnpm skill:check` keeps the zip and that manifest in step. The version stays 0.1.0.
 *
 * NEXT_PUBLIC_TOPICCRAFTER_SKILL_URL replaces it with an external http(s) link. Next.js inlines
 * NEXT_PUBLIC_* values at build time, so it must be set when the image is built. A value that is
 * blank or not an http(s) URL is ignored. Ported from topic-ingester (src/server/public-config.ts).
 */
import release from "./skill-release.json";

export type SkillLink =
  | { kind: "download"; href: string; version: string }
  | { kind: "external"; href: string };

/** The bundled zip: `/skill/TopicCrafter-v<version>.zip`. */
export const BUNDLED_SKILL: SkillLink = {
  kind: "download",
  href: `/skill/${release.file}`,
  version: release.version,
};

/** The bundled zip, or an external link when `value` is an http(s) URL. */
export function topicCrafterSkill(value: string | undefined): SkillLink {
  const trimmed = value?.trim();
  if (!trimmed) return BUNDLED_SKILL;
  try {
    const url = new URL(trimmed);
    return url.protocol === "https:" || url.protocol === "http:"
      ? { kind: "external", href: url.toString() }
      : BUNDLED_SKILL;
  } catch {
    return BUNDLED_SKILL;
  }
}

export const SKILL_LINK: SkillLink = topicCrafterSkill(
  process.env.NEXT_PUBLIC_TOPICCRAFTER_SKILL_URL,
);
