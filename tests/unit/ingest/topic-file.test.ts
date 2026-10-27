import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  brokenJsonMessage,
  checkFileMeta,
  checkTopicText,
  describeDifficulty,
  downloadBaseName,
  FILE_MESSAGES,
  locateJsonError,
  MAX_TOPIC_BYTES,
  topicSlug,
} from "@/lib/ingest/topic-file";

const fixture = (name: string) =>
  readFileSync(
    new URL(`../../fixtures/ingest/${name}`, import.meta.url),
    "utf8",
  );
// topic-ingester's tests/fixtures/broken_topic.json, inline: Prettier can't parse a broken .json file.
const BROKEN_TOPIC =
  '{\n  "topic_id": "x"\n  "topic_name": "Broken Example",\n  "cts": []\n}\n';
const NOT_JSON =
  "This platform takes the .json file. Ask your assistant for the .json it made from your .md.";

describe("checkFileMeta", () => {
  it("refuses .md, .markdown and anything that isn't .json", () => {
    for (const name of [
      "topic.md",
      "TOPIC.MD",
      "notes.markdown",
      "topic.docx",
      "topic.txt",
      "topic",
    ]) {
      const result = checkFileMeta(name, 100);
      expect(result && !result.ok && result.message).toBe(NOT_JSON);
    }
  });

  it("refuses empty files and files over 10 MB", () => {
    expect(checkFileMeta("topic.json", 0)).toMatchObject({
      ok: false,
      problem: "empty",
    });
    expect(checkFileMeta("topic.json", MAX_TOPIC_BYTES + 1)).toMatchObject({
      ok: false,
      problem: "too_large",
    });
    expect(checkFileMeta("Topic.JSON", MAX_TOPIC_BYTES)).toBeNull();
  });
});

describe("checkTopicText", () => {
  it("accepts a topic and summarises it", () => {
    const result = checkTopicText(fixture("mixed_practice.json"));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.summary).toMatchObject({
      topicName: "Mixed Maths and Science Practice",
      questionSets: 18,
      questions: 27,
    });
    expect(
      result.summary.difficulty.easy +
        result.summary.difficulty.medium +
        result.summary.difficulty.hard,
    ).toBe(27);
  });

  it("refuses Markdown even when it is named .json", () => {
    expect(checkTopicText(fixture("mixed_practice.md"))).toMatchObject({
      ok: false,
      message: NOT_JSON,
    });
  });

  it("names the line and column of broken JSON", () => {
    const result = checkTopicText(BROKEN_TOPIC);
    expect(result).toMatchObject({
      ok: false,
      problem: "broken_json",
      line: 3,
      column: 3,
    });
    if (!result.ok) expect(result.message).toContain("on line 3, column 3");
  });

  it("refuses JSON that isn't a topic, or a topic without question sets", () => {
    expect(checkTopicText(fixture("not_a_topic.json"))).toMatchObject({
      ok: false,
      message: FILE_MESSAGES.notTopic,
    });
    expect(checkTopicText("[1, 2, 3]")).toMatchObject({
      ok: false,
      problem: "not_topic",
    });
    expect(checkTopicText('{"topic_name": "X", "cts": []}')).toMatchObject({
      ok: false,
      problem: "no_question_sets",
    });
  });

  it("ignores a byte-order mark and refuses empty text", () => {
    expect(
      checkTopicText(
        '﻿{"topic_name":"A","cts":[{"key":"k","variations":[{}]}]}',
      ).ok,
    ).toBe(true);
    expect(checkTopicText("   \n")).toMatchObject({
      ok: false,
      problem: "empty",
    });
  });
});

describe("locateJsonError", () => {
  const cases: Array<[string, number, number]> = [
    ['{"a": 1,}', 1, 9], // trailing comma
    ['{"a": 1\n "b": 2}', 2, 2], // missing comma
    ['{\n  "a": tru\n}', 2, 8], // bad literal
    ['{"a": "line\nbreak"}', 1, 12], // raw line break in text
    ['{"a": [1, 2}', 1, 12], // wrong closing bracket
    ['{"a": 1} x', 1, 10], // trailing content
    ['{"a": "unterminated', 1, 20], // missing closing quote
    ["{'a': 1}", 1, 2], // single quotes
    ['{"a": 01}', 1, 8], // leading zero
  ];
  it.each(cases)("%j -> line %i, column %i", (text, line, column) => {
    expect(() => JSON.parse(text)).toThrow();
    expect(locateJsonError(text)).toMatchObject({ line, column });
  });

  it("returns null for valid JSON", () => {
    expect(locateJsonError(fixture("mixed_practice.json"))).toBeNull();
    expect(
      locateJsonError('{"a": [1, -2.5e3, true, false, null, "\\u00e9\\n"]}'),
    ).toBeNull();
  });

  it("words the message for a non-technical reader", () => {
    expect(brokenJsonMessage(4, 7)).toMatch(
      /^This file has a formatting mistake on line 4, column 7/,
    );
    expect(brokenJsonMessage()).not.toMatch(/line/);
  });
});

describe("names", () => {
  it("slugs topic names the way the skill does", () => {
    expect(topicSlug("Photosynthesis (Grade 8)")).toBe(
      "photosynthesis_grade_8",
    );
    expect(topicSlug("Équations & Fonctions")).toBe("equations_fonctions");
    expect(
      topicSlug("Mixed Math and Science Practice (all 18 question types)"),
    ).toBe("mixed_math_and_science_practice_all_18_question");
    expect(
      topicSlug("Mixed Math and Science Practice (all 18 question types)")
        .length,
    ).toBeLessThanOrEqual(50);
    expect(topicSlug("प्रकाश संश्लेषण")).toBe("topic");
  });

  it("keeps the creator's own file name when it is already a slug", () => {
    expect(
      downloadBaseName({
        fileName: "photosynthesis_grade_8.json",
        topicName: "Whatever",
      }),
    ).toBe("photosynthesis_grade_8");
    expect(
      downloadBaseName({
        fileName: "photosynthesis_grade_8 (1).json",
        topicName: "Photosynthesis (Grade 8)",
      }),
    ).toBe("photosynthesis_grade_8");
    expect(downloadBaseName({ topicName: "" })).toBe("topic");
  });

  it("describes the difficulty spread", () => {
    expect(describeDifficulty({ easy: 12, medium: 12, hard: 6 })).toBe(
      "12 easy, 12 medium and 6 hard",
    );
    expect(describeDifficulty({ easy: 0, medium: 3, hard: 0 })).toBe(
      "3 medium",
    );
    expect(describeDifficulty({ easy: 0, medium: 0, hard: 0 })).toBe("");
  });
});
