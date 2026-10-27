import { describe, expect, it } from "vitest";

import {
  ctIndexOf,
  GENERIC_ISSUE,
  groupIssues,
  labelSetsInMarkdown,
  plainField,
  plainSentence,
  SET_KEY_MARKER,
} from "@/lib/ingest/plain-issues";

const TOPIC = {
  cts: [
    { key: "fractions_ct_001" },
    { key: "two_step_equations_ct_002" },
    { key: "ratios_ct_003" },
  ],
};
const INDEX = ctIndexOf(TOPIC);

describe("plainSentence (the skill's communication table, present tense)", () => {
  it.each([
    [
      {
        code: "PUNCTUATION",
        field: "hint",
        message: "Make sure the hint ends with '.'.",
      },
      "The hint needs to end as a statement, with a full stop.",
    ],
    [
      {
        code: "PUNCTUATION",
        message: "Hint should not end with question mark",
      },
      "The hint needs to end as a statement, with a full stop.",
    ],
    [
      { code: "HINT REQUIRED", message: "Hint is required" },
      "A hint is missing.",
    ],
    [
      { code: "PARSER LATEX", message: "Parser Lambda failed: bad" },
      "A maths expression isn't written in a way the platform can display.",
    ],
    [
      {
        code: "PYDANTIC",
        message: "LaTeX error in solution: unbalanced braces",
      },
      "A maths expression isn't written in a way the platform can display.",
    ],
    [
      { code: "PYDANTIC", message: "Field required" },
      "A part of the question is missing or in the wrong form.",
    ],
    [
      { code: "ANSWER BOX PLACEHOLDER VISIBILITY", message: "x" },
      "An answer box is inside the question text instead of below it.",
    ],
    [
      { code: "SUBPART PLACEHOLDER VISIBILITY", message: "x" },
      "A blank is in the shared intro instead of in a part.",
    ],
    [
      {
        code: "IDENTITY",
        message: "Duplicate CT key 'a': CT keys must be unique",
      },
      "Two CTs have the same label.",
    ],
    [
      { code: "IDENTITY", message: "Duplicate question_no 2" },
      "Two variants in a CT share the same label.",
    ],
    [
      { code: "TOPIC", message: "Missing 'topic_id'" },
      "The topic's header details need a fix.",
    ],
    [
      { code: "CT", message: "CT has no variations" },
      "The CT's header details need a fix.",
    ],
    [
      { code: "SYSTEM FIELDS", message: "x" },
      "The question's header details need a fix.",
    ],
    [
      { code: "STYLE", severity: "warning", message: "Markdown emphasis" },
      "Some bold or italic styling the platform doesn't show.",
    ],
    [{ code: "SOMETHING NEW", message: "?" }, GENERIC_ISSUE],
  ])("%j", (finding, sentence) => {
    expect(plainSentence(finding)).toBe(sentence);
  });

  it("never leaks a code or CT key", () => {
    expect(
      plainSentence({
        code: "IDENTITY",
        message: "Duplicate CT key 'fractions_ct_001'",
      }),
    ).not.toMatch(/_|IDENTITY|fractions/);
  });
});

describe("plainField", () => {
  it("names fields the way a creator would", () => {
    expect(plainField("hint")).toBe("Hint");
    expect(plainField("correct_options")).toBe("Correct answers");
    expect(plainField("subparts[1].solution")).toBe("Part 2, solution");
    expect(plainField("placeholders[0].value")).toBe("Answer box 1");
    expect(plainField(undefined)).toBeUndefined();
    expect(plainField("weird field!")).toBeUndefined();
  });
});

describe("groupIssues", () => {
  it("groups by 'CT N, variant M' using the CT's position in the topic, whole-topic items first", () => {
    const groups = groupIssues(
      [
        {
          severity: "error",
          code: "PUNCTUATION",
          ctKey: "ratios_ct_003",
          questionNo: 2,
          field: "hint",
          message: "m",
        },
        {
          severity: "error",
          code: "HINT REQUIRED",
          ctKey: "two_step_equations_ct_002",
          questionNo: 3,
          message: "m",
        },
        {
          severity: "error",
          code: "PUNCTUATION",
          ctKey: "ratios_ct_003",
          questionNo: 2,
          field: "hint",
          message: "m2",
        },
        { severity: "error", code: "TOPIC", message: "Missing 'topic_id'" },
        {
          severity: "warning",
          code: "STYLE",
          ctKey: "two_step_equations_ct_002",
          questionNo: 3,
          message: "m",
        },
        {
          severity: "error",
          code: "CT",
          ctKey: "fractions_ct_001",
          message: "CT has no variations",
        },
      ],
      INDEX,
    );
    expect(groups.map((g) => g.label)).toEqual([
      "Whole topic",
      "CT 1",
      "CT 2, variant 3",
      "CT 3, variant 2",
    ]);
    expect(groups[2]!.ctKey).toBe("two_step_equations_ct_002");
    expect(groups[2]!.issues).toEqual([
      { text: "A hint is missing.", where: undefined, optional: false },
      {
        text: "Some bold or italic styling the platform doesn't show.",
        where: undefined,
        optional: true,
      },
    ]);
    // Same sentence in the same place is listed once.
    expect(groups[3]!.issues).toHaveLength(1);
    expect(groups[3]!.issues[0]!.where).toBe("Hint");
  });

  it("doesn't invent a set number for a key that isn't in the topic", () => {
    expect(
      groupIssues(
        [
          {
            code: "PUNCTUATION",
            ctKey: "gone_ct_009",
            questionNo: 1,
            message: "m",
          },
        ],
        INDEX,
      )[0]!.label,
    ).toBe("A CT, variant 1");
  });
});

describe("labelSetsInMarkdown", () => {
  it("replaces CT keys with set and variant labels, keeping the key as a muted reference", () => {
    const md =
      "Fixed:\n- ratios_ct_003 / 1: added the missing period to the hint\n- `fractions_ct_001`, question 2: fixed\n- two_step_equations_ct_002 checked";
    expect(labelSetsInMarkdown(md, INDEX)).toBe(
      "Fixed:\n" +
        `- CT 3, variant 1 \`${SET_KEY_MARKER}ratios_ct_003\`: added the missing period to the hint\n` +
        `- CT 1, variant 2 \`${SET_KEY_MARKER}fractions_ct_001\`: fixed\n` +
        `- CT 2 \`${SET_KEY_MARKER}two_step_equations_ct_002\` checked`,
    );
  });

  it("leaves code blocks and unknown text alone", () => {
    const md = "```\nratios_ct_003 / 1\n```\nnothing to see";
    expect(labelSetsInMarkdown(md, INDEX)).toBe(md);
    expect(labelSetsInMarkdown("ratios_ct_003", {})).toBe("ratios_ct_003");
  });
});

describe("PLATFORM findings", () => {
  it("say what the creator's assistant should add", () => {
    expect(
      plainSentence({
        code: "PLATFORM",
        severity: "warning",
        message: "Match has no explanation",
        field: "matches[0].explanation",
      }),
    ).toBe("A matching pair needs a short explanation.");
  });
});
