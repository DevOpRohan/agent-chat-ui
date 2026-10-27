/**
 * Checks a topic file before it is uploaded, and summarises it.
 *
 * Pure functions, used by the browser (to give instant, plain answers before the
 * upload) and by the ingest pane (to name downloads; see record-view.ts). The
 * topic_ingest graph re-checks everything; these checks only catch the common
 * mistakes early: the .md instead of the .json, a damaged file, or a file that
 * isn't a topic at all.
 *
 * Ported from topic-ingester (src/lib/topic-file.ts), using CT terminology in
 * creator-facing text.
 */

/** Same limit as the backend (`MAX_SOURCE_BYTES` in topic_import/pipeline.py). */
export const MAX_TOPIC_BYTES = 10 * 1024 * 1024;

export const FILE_MESSAGES = {
  notJson:
    "This platform takes the .json file. Ask your assistant for the .json it made from your .md.",
  tooLarge:
    "This file is bigger than 10 MB, which is more than the platform accepts. Check that it's your topic's .json file, or ask your assistant to make it again.",
  empty:
    "This file is empty. Ask your assistant for the .json it made from your .md.",
  notTopic:
    "This file doesn't look like a topic. Please pick the .json your assistant made for your topic with the TopicCrafter skill.",
  noQuestionSets:
    "This topic doesn't have any CTs yet. Ask your assistant to make the .json again from your .md.",
  oneFile: "Please upload one file at a time.",
  unreadable:
    "We couldn't open this file. Please try again, or ask your assistant for a fresh copy of the .json.",
} as const;

export function brokenJsonMessage(line?: number, column?: number): string {
  const where = line && column ? ` on line ${line}, column ${column}` : "";
  return (
    `This file has a formatting mistake${where}, so we can't read it. ` +
    "This usually happens when the file was changed by hand or didn't finish downloading. " +
    "Ask your assistant to make the .json again from your .md."
  );
}

export type FileProblem =
  | "not_json"
  | "too_large"
  | "empty"
  | "broken_json"
  | "not_topic"
  | "no_question_sets"
  | "multiple_files"
  | "unreadable";

export interface Difficulty {
  easy: number;
  medium: number;
  hard: number;
}

export interface TopicSummary {
  topicName: string;
  /** The topic's own id: uploads of the same topic share it. */
  topicId?: string;
  questionSets: number;
  questions: number;
  difficulty: Difficulty;
}

export type FileCheck =
  | { ok: true; text: string; summary: TopicSummary }
  | {
      ok: false;
      problem: FileProblem;
      message: string;
      line?: number;
      column?: number;
      detail?: string;
    };

function fail(
  problem: FileProblem,
  message: string,
  extra: { line?: number; column?: number; detail?: string } = {},
): FileCheck {
  return { ok: false, problem, message, ...extra };
}

/** Checks that need only the file's name and size (before reading it). */
export function checkFileMeta(name: string, size: number): FileCheck | null {
  const lower = name.trim().toLowerCase();
  if (!lower.endsWith(".json")) return fail("not_json", FILE_MESSAGES.notJson);
  if (size > MAX_TOPIC_BYTES) return fail("too_large", FILE_MESSAGES.tooLarge);
  if (size === 0) return fail("empty", FILE_MESSAGES.empty);
  return null;
}

export function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

export function utf8Length(text: string): number {
  return new TextEncoder().encode(text).length;
}

/** Checks the file's text: is it JSON, and is it a topic? */
export function checkTopicText(raw: string): FileCheck {
  const text = stripBom(raw);
  if (utf8Length(text) > MAX_TOPIC_BYTES)
    return fail("too_large", FILE_MESSAGES.tooLarge);
  const trimmed = text.trimStart();
  if (!trimmed) return fail("empty", FILE_MESSAGES.empty);
  // Markdown, plain text or anything else that can't be JSON (the backend uses the same test).
  if (trimmed[0] !== "{" && trimmed[0] !== "[")
    return fail("not_json", FILE_MESSAGES.notJson);

  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    const where = locateJsonError(text) ?? positionFromMessage(text, error);
    return fail("broken_json", brokenJsonMessage(where?.line, where?.column), {
      line: where?.line,
      column: where?.column,
      detail: where?.expected
        ? `Expected ${where.expected}`
        : error instanceof Error
          ? error.message
          : undefined,
    });
  }

  if (!isRecord(value) || !Array.isArray(value.cts))
    return fail("not_topic", FILE_MESSAGES.notTopic);
  if (value.cts.length === 0)
    return fail("no_question_sets", FILE_MESSAGES.noQuestionSets);
  return { ok: true, text, summary: summarizeTopic(value) };
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function summarizeTopic(topic: Record<string, unknown>): TopicSummary {
  const cts = Array.isArray(topic.cts) ? topic.cts : [];
  const difficulty: Difficulty = { easy: 0, medium: 0, hard: 0 };
  let questions = 0;
  for (const ct of cts) {
    if (!isRecord(ct) || !Array.isArray(ct.variations)) continue;
    for (const question of ct.variations) {
      questions += 1;
      const level = (
        isRecord(question) && typeof question.difficulty_level === "string"
          ? question.difficulty_level
          : typeof ct.difficulty_level === "string"
            ? ct.difficulty_level
            : ""
      ).toLowerCase();
      if (level === "easy" || level === "medium" || level === "hard")
        difficulty[level] += 1;
    }
  }
  const name =
    typeof topic.topic_name === "string" ? topic.topic_name.trim() : "";
  const id = typeof topic.topic_id === "string" ? topic.topic_id.trim() : "";
  return {
    topicName: name || "Untitled topic",
    ...(id ? { topicId: id } : {}),
    questionSets: cts.length,
    questions,
    difficulty,
  };
}

/** "12 easy, 12 medium and 6 hard", or "" when the file has no difficulty levels. */
export function describeDifficulty(d: Difficulty): string {
  const parts = (["easy", "medium", "hard"] as const)
    .filter((k) => d[k] > 0)
    .map((k) => `${d[k]} ${k}`);
  if (parts.length <= 1) return parts.join("");
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/**
 * `<topic_name>` as the TopicCrafter skill names files: lowercase letters, digits
 * and underscores, at most 50 characters ("Photosynthesis (Grade 8)" ->
 * "photosynthesis_grade_8").
 */
export function topicSlug(name: string): string {
  let slug = name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (slug.length > 50) {
    const cut = slug.slice(0, 51);
    const lastBreak = cut.lastIndexOf("_");
    slug = (
      lastBreak >= 20 ? cut.slice(0, lastBreak) : cut.slice(0, 50)
    ).replace(/_+$/g, "");
  }
  return slug || "topic";
}

const SLUG_RE = /^[a-z0-9_]{1,50}$/;

/**
 * Base name for downloads. The creator's own file name wins when it is already a
 * skill-style slug (so the file they get back matches the one they keep), else
 * the slug of the topic name.
 */
export function downloadBaseName(input: {
  fileName?: string | null;
  topicName?: string | null;
}): string {
  const stem = (input.fileName ?? "").replace(/\.json$/i, "");
  if (SLUG_RE.test(stem)) return stem;
  return topicSlug(input.topicName ?? "");
}

// ---------------------------------------------------------------- JSON error location

export interface JsonErrorLocation {
  offset: number;
  line: number;
  column: number;
  expected: string;
}

class ScanError extends Error {
  constructor(
    readonly offset: number,
    readonly expected: string,
  ) {
    super(expected);
  }
}

export function lineAndColumn(
  text: string,
  offset: number,
): { line: number; column: number } {
  let line = 1;
  let lineStart = 0;
  const end = Math.min(offset, text.length);
  for (let i = 0; i < end; i++) {
    if (text.charCodeAt(i) === 10) {
      line += 1;
      lineStart = i + 1;
    }
  }
  return { line, column: end - lineStart + 1 };
}

const NUMBER_RE = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y;
const MAX_DEPTH = 5000;

/**
 * Finds where strict JSON first goes wrong. Browsers word JSON.parse errors
 * differently (and Safari gives no position), so we locate the error ourselves.
 * Returns null when the text is valid JSON.
 */
export function locateJsonError(text: string): JsonErrorLocation | null {
  let i = 0;
  const n = text.length;

  const failAt = (expected: string, at = i): never => {
    throw new ScanError(at, expected);
  };
  const skipWs = () => {
    while (i < n) {
      const c = text.charCodeAt(i);
      if (c === 32 || c === 9 || c === 10 || c === 13) i++;
      else break;
    }
  };
  const scanString = () => {
    i++; // opening quote
    while (i < n) {
      const c = text.charCodeAt(i);
      if (c === 34) {
        i++;
        return;
      }
      if (c === 92) {
        const e = text[i + 1];
        if (e === "u") {
          if (!/^[0-9a-fA-F]{4}$/.test(text.slice(i + 2, i + 6)))
            failAt("a valid \\u escape");
          i += 6;
          continue;
        }
        if (e !== undefined && '"\\/bfnrt'.includes(e)) {
          i += 2;
          continue;
        }
        failAt("a valid escape sequence");
      }
      if (c < 32)
        failAt("the text to close with a double quote before the line ends");
      i++;
    }
    failAt("a closing double quote");
  };
  const scanValue = (depth: number): void => {
    if (depth > MAX_DEPTH) failAt("less deeply nested data");
    skipWs();
    if (i >= n) failAt("a value");
    const ch = text[i];
    if (ch === "{") return scanObject(depth + 1);
    if (ch === "[") return scanArray(depth + 1);
    if (ch === '"') return scanString();
    if (ch === "-" || (ch !== undefined && ch >= "0" && ch <= "9")) {
      NUMBER_RE.lastIndex = i;
      if (!NUMBER_RE.test(text)) failAt("a number");
      i = NUMBER_RE.lastIndex;
      return;
    }
    for (const literal of ["true", "false", "null"]) {
      if (text.startsWith(literal, i)) {
        i += literal.length;
        return;
      }
    }
    failAt("a value");
  };
  const scanObject = (depth: number): void => {
    i++;
    skipWs();
    if (text[i] === "}") {
      i++;
      return;
    }
    for (;;) {
      skipWs();
      if (text[i] !== '"') failAt("a property name in double quotes");
      scanString();
      skipWs();
      if (text[i] !== ":") failAt("':' after the property name");
      i++;
      scanValue(depth);
      skipWs();
      if (text[i] === ",") {
        i++;
        continue;
      }
      if (text[i] === "}") {
        i++;
        return;
      }
      failAt("',' or '}'");
    }
  };
  const scanArray = (depth: number): void => {
    i++;
    skipWs();
    if (text[i] === "]") {
      i++;
      return;
    }
    for (;;) {
      scanValue(depth);
      skipWs();
      if (text[i] === ",") {
        i++;
        continue;
      }
      if (text[i] === "]") {
        i++;
        return;
      }
      failAt("',' or ']'");
    }
  };

  try {
    scanValue(0);
    skipWs();
    if (i < n) failAt("the end of the file");
    return null;
  } catch (error) {
    if (!(error instanceof ScanError)) return null;
    return {
      offset: error.offset,
      expected: error.expected,
      ...lineAndColumn(text, error.offset),
    };
  }
}

/** Fallback: read the position from the engine's own error message. */
function positionFromMessage(
  text: string,
  error: unknown,
): JsonErrorLocation | null {
  const message = error instanceof Error ? error.message : "";
  const lc = message.match(/line (\d+) column (\d+)/i);
  if (lc)
    return {
      offset: -1,
      line: Number(lc[1]),
      column: Number(lc[2]),
      expected: "",
    };
  const pos = message.match(/position (\d+)/i);
  if (pos) {
    const offset = Number(pos[1]);
    return { offset, expected: "", ...lineAndColumn(text, offset) };
  }
  return null;
}
