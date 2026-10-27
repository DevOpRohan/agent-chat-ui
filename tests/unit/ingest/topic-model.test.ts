import { readFileSync } from "node:fs";

import * as lucide from "lucide-react";
import { describe, expect, it } from "vitest";

import {
  ANSWER_BOX_TYPE_IDS,
  BASE_QUESTION_TYPE_IDS,
  DIFFICULTY_LEVELS,
  isBaseQuestionType,
  isMultipartQuestion,
  isPartOfType,
  isQuestionOfType,
  isQuestionType,
  isSubpartType,
  QUESTION_TYPE_IDS,
  QUESTION_TYPES,
  questionTypeCounts,
  questionTypeInfo,
  readTopicQuestions,
  SUBPART_TYPE_IDS,
} from "@/lib/ingest/topic-model";
import type {
  AcceptanceTolerance,
  BaseQuestionTypeId,
  DecimalPart,
  DecimalQuestion,
  DecimalSubpart,
  DropDownPlaceholder,
  HybridSubpart,
  KeywordPlaceholder,
  McqPart,
  McqQuestion,
  MtcMatch,
  MtcPart,
  MtcQuestion,
  OpenEndedQuestion,
  OpenEndedSubpart,
  PartByType,
  PartsOf,
  PatternMatchQuestion,
  QuestionByType,
  QuestionPart,
  QuestionTypeId,
  SubpartTypeId,
  Topic,
  TopicCt,
  TopicQuestion,
} from "@/lib/ingest/topic-model";

const allTypes: unknown = JSON.parse(
  readFileSync(
    new URL("../../fixtures/ingest/all_types.json", import.meta.url),
    "utf8",
  ),
);

// ------------------------------------------------------------------ compile-time checks

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
    ? true
    : false;
type Expect<T extends true> = T;
type IsRequired<T, K extends keyof T> =
  Record<never, never> extends Pick<T, K> ? false : true;
type HasKey<T, K extends PropertyKey> = K extends keyof T ? true : false;

// Exported only so the checks count as used; `tsc --noEmit` evaluates every one of them.
export type _TypeChecks = [
  // Each map key is its interface's discriminant, and the unions cover exactly the ids.
  Expect<
    Equal<
      { [K in QuestionTypeId]: QuestionByType[K]["question_type"] },
      { [K in QuestionTypeId]: K }
    >
  >,
  Expect<
    Equal<
      { [K in BaseQuestionTypeId]: PartByType[K]["question_type"] },
      { [K in BaseQuestionTypeId]: K }
    >
  >,
  Expect<Equal<TopicQuestion["question_type"], QuestionTypeId>>,
  Expect<Equal<QuestionPart["question_type"], BaseQuestionTypeId>>,
  Expect<Equal<SubpartTypeId extends QuestionTypeId ? true : false, true>>,
  Expect<Equal<PartsOf<"MCQ_SUBPART">, McqPart>>,
  Expect<Equal<PartsOf<"DECIMAL_SUBPART">, DecimalPart>>,
  Expect<Equal<PartsOf<"HYBRID_SUBPART">, QuestionPart>>,
  // Required vs optional, as the Python models and the platform verifier say.
  Expect<Equal<IsRequired<McqQuestion, "options">, true>>,
  Expect<Equal<IsRequired<McqQuestion, "correct_options">, true>>,
  Expect<Equal<IsRequired<McqQuestion, "hint">, true>>,
  Expect<Equal<IsRequired<McqQuestion, "difficulty_level">, true>>,
  Expect<Equal<IsRequired<McqQuestion, "language">, false>>,
  Expect<Equal<IsRequired<McqQuestion, "ct_key">, false>>,
  Expect<Equal<IsRequired<McqQuestion, "question_no">, false>>,
  Expect<Equal<IsRequired<McqPart, "difficulty_level">, false>>,
  Expect<Equal<IsRequired<OpenEndedQuestion, "hint">, true>>,
  Expect<Equal<IsRequired<MtcQuestion, "question">, false>>,
  Expect<Equal<IsRequired<MtcQuestion, "hint">, false>>,
  Expect<Equal<IsRequired<MtcQuestion, "solution">, false>>,
  Expect<Equal<IsRequired<MtcQuestion, "matches">, true>>,
  Expect<Equal<IsRequired<MtcPart, "hint">, true>>,
  Expect<Equal<IsRequired<MtcMatch, "hint">, true>>,
  Expect<Equal<IsRequired<MtcMatch, "explanation">, false>>,
  Expect<Equal<IsRequired<KeywordPlaceholder, "incorrect_keywords">, false>>,
  Expect<Equal<DropDownPlaceholder["correct_keyword"], string>>,
  Expect<Equal<IsRequired<DecimalQuestion, "language">, true>>,
  Expect<Equal<IsRequired<DecimalQuestion, "difficulty_level">, false>>,
  Expect<Equal<IsRequired<DecimalPart, "language">, true>>,
  Expect<Equal<keyof AcceptanceTolerance, "lower" | "upper">>,
  Expect<Equal<HasKey<PatternMatchQuestion, "answers_interchangeable">, false>>,
  Expect<Equal<HasKey<PatternMatchQuestion, "acceptance_tolerance">, false>>,
  Expect<Equal<HasKey<DecimalQuestion, "matching">, false>>,
  Expect<Equal<IsRequired<OpenEndedSubpart, "question">, false>>,
  Expect<Equal<IsRequired<OpenEndedSubpart, "difficulty_level">, true>>,
  Expect<Equal<IsRequired<DecimalSubpart, "question">, true>>,
  Expect<Equal<IsRequired<DecimalSubpart, "language">, true>>,
  Expect<Equal<IsRequired<DecimalSubpart, "difficulty_level">, false>>,
  Expect<Equal<HasKey<DecimalSubpart, "solution">, false>>,
  Expect<Equal<HasKey<DecimalSubpart, "hint">, false>>,
  Expect<Equal<IsRequired<Topic, "topic_id">, true>>,
  Expect<Equal<IsRequired<Topic, "topic_name">, false>>,
  Expect<Equal<IsRequired<TopicCt, "difficulty_level">, true>>,
];

const texts = { question: "Q", solution: "S", hint: "H." };

// @ts-expect-error -- an MCQ needs options and correct_options
const _mcqWithoutOptions: McqQuestion = {
  question_type: "MCQ",
  difficulty_level: "EASY",
  ...texts,
};
// @ts-expect-error -- a top-level OPEN_ENDED needs difficulty_level
const _noDifficulty: OpenEndedQuestion = {
  question_type: "OPEN_ENDED",
  ...texts,
};
// @ts-expect-error -- an MTC part needs its own hint
const _mtcPartWithoutHint: MtcPart = { question_type: "MTC", matches: [] };
const _segmentKeyword: DropDownPlaceholder = {
  placeholder_id: 1,
  // @ts-expect-error -- dropdown keywords are plain strings, not segments
  correct_keyword: [{ type: "text", text: "x" }],
};
const trueFalsePart = {
  question_type: "TRUE_FALSE",
  correct_answer: true,
  ...texts,
} as const;
const _wrongPart: OpenEndedSubpart = {
  question_type: "OPEN_ENDED_SUBPART",
  difficulty_level: "MEDIUM",
  // @ts-expect-error -- OPEN_ENDED_SUBPART parts are OPEN_ENDED only
  subparts: [trueFalsePart],
};
const _typedParentSolution: DecimalSubpart = {
  question_type: "DECIMAL_SUBPART",
  question: "Context.",
  language: "English",
  subparts: [],
  // @ts-expect-error -- typed multi-part parents have no solution (unknown fields are rejected)
  solution: "",
};
const _badDifficulty: OpenEndedQuestion = {
  question_type: "OPEN_ENDED",
  // @ts-expect-error -- difficulty is EASY, MEDIUM or HARD
  difficulty_level: "VERY_HARD",
  ...texts,
};

// One literal per type, with the same structure as the first question of that type in
// all_types.json (texts shortened). `satisfies` proves the structure fits the types; the shape
// test below proves it matches the example exactly.
const image = {
  type: "media",
  media_type: "image",
  url: "https://example.com/assets/figure.png",
  description: "A figure",
} as const;

const SAMPLES = {
  MCQ: {
    question_type: "MCQ",
    question: [
      { type: "text", text: "The graph is shown below.\n" },
      image,
      { type: "text", text: "\nSelect all intercepts." },
    ],
    difficulty_level: "MEDIUM",
    options: ["\\(x = -2\\)", "\\(x = 2\\)", "\\(x = 4\\)", "\\(x = -4\\)"],
    correct_options: ["\\(x = -2\\)", "\\(x = 2\\)"],
    solution: "Set \\(y = 0\\).",
    hint: "Set \\(y = 0\\) and factor.",
    language: "English",
    ct_key: "quadratic_x_intercepts_ct_001",
    question_no: 1,
  },
  OPEN_ENDED: {
    question_type: "OPEN_ENDED",
    question: "Explain why the sum of two odd integers is even.",
    difficulty_level: "MEDIUM",
    solution: "\\(2m + 1 + 2n + 1 = 2(m + n + 1)\\).",
    hint: "Write each odd integer as \\(2k + 1\\).",
    language: "English",
    ct_key: "odd_even_proofs_ct_002",
    question_no: 1,
  },
  TRUE_FALSE: {
    question_type: "TRUE_FALSE",
    question: "The angles of a triangle add up to \\(180^\\circ\\).",
    difficulty_level: "EASY",
    correct_answer: true,
    solution: "Alternate angles form a straight line.",
    hint: "Draw a line through one vertex.",
    language: "English",
    ct_key: "polygon_angle_sums_ct_003",
    question_no: 1,
  },
  FIB: {
    question_type: "FIB",
    question: "Water boils at {placeholder1} degrees Celsius.",
    difficulty_level: "EASY",
    placeholders: [
      {
        placeholder_id: 1,
        correct_keyword: "100",
        incorrect_keywords: ["90", "110", "120"],
      },
    ],
    solution: "Water boils at \\(100^\\circ\\text{C}\\).",
    hint: "Think about standard pressure.",
    language: "English",
    ct_key: "water_phase_changes_ct_004",
    question_no: 1,
  },
  DROP_DOWN: {
    question_type: "DROP_DOWN",
    question: "The formula of table salt is {placeholder1}.",
    difficulty_level: "EASY",
    placeholders: [
      {
        placeholder_id: 1,
        correct_keyword: "NaCl",
        incorrect_keywords: ["KCl", "NaOH", "CaCl2"],
      },
    ],
    solution: "Table salt is \\(\\text{NaCl}\\).",
    hint: "Table salt contains sodium and chlorine.",
    language: "English",
    ct_key: "common_compound_formulas_ct_005",
    question_no: 1,
  },
  MTC: {
    question_type: "MTC",
    question: "Match each organelle with its function.",
    difficulty_level: "EASY",
    matches: [
      {
        left: "Mitochondrion",
        right: "Aerobic respiration",
        hint: "Think about where energy is released.",
        explanation: "Mitochondria release energy.",
      },
      {
        left: "Ribosome",
        right: "Protein synthesis",
        hint: "Think about amino acids.",
        explanation: "",
      },
    ],
    language: "English",
    ct_key: "organelle_functions_ct_006",
    question_no: 1,
  },
  DECIMAL: {
    question_type: "DECIMAL",
    question: "Solve \\(2x + 5 = 15\\) for \\(x\\).",
    difficulty_level: "EASY",
    placeholders: [{ placeholder_id: 1, value: 5, min_decimal_places: 0 }],
    acceptance_tolerance: { lower: 0, upper: 0 },
    answers_interchangeable: false,
    answer_box: "\\(x =\\) {placeholder1}",
    solution: "\\(x = 5\\).",
    hint: "Undo the operations in reverse order.",
    language: "English",
    ct_key: "linear_equations_ct_007",
    question_no: 1,
  },
  MATH_EXPRESSION: {
    question_type: "MATH_EXPRESSION",
    question: "Factor \\(x^2 - 6x + 9\\) completely.",
    difficulty_level: "EASY",
    matching: "EQUIVALENT",
    placeholders: [
      {
        placeholder_id: 1,
        value: "\\((x-3)^2\\)",
        variables: ["x"],
        valid_alternatives: ["\\((3-x)^2\\)"],
      },
    ],
    answers_interchangeable: false,
    answer_box: "{placeholder1}",
    solution: "\\(x^2 - 6x + 9 = (x-3)^2\\).",
    hint: "Look for a perfect-square trinomial.",
    language: "English",
    ct_key: "perfect_square_factoring_ct_008",
    question_no: 2,
  },
  PATTERN_MATCH: {
    question_type: "PATTERN_MATCH",
    question: "Write the chemical symbol for sodium.",
    difficulty_level: "EASY",
    placeholders: [{ placeholder_id: 1, value: "Na", valid_examples: ["Na"] }],
    answer_box: "Symbol: {placeholder1}",
    solution: "Sodium is \\(\\text{Na}\\).",
    hint: "The symbol comes from the Latin name.",
    language: "English",
    ct_key: "element_symbols_ct_009",
    question_no: 1,
  },
  OPEN_ENDED_SUBPART: {
    question_type: "OPEN_ENDED_SUBPART",
    question: [{ type: "text", text: "Rectangle \\(ABCD\\).\n" }, image],
    difficulty_level: "MEDIUM",
    subparts: [
      {
        question_type: "OPEN_ENDED",
        question: "Find the area.",
        solution: "\\(24\\,\\text{cm}^2\\).",
        hint: "Multiply the length by the width.",
      },
    ],
    language: "English",
    ct_key: "rectangle_measurements_ct_010",
    question_no: 1,
  },
  MCQ_SUBPART: {
    question_type: "MCQ_SUBPART",
    question: "Consider the data set \\(4, 6, 6, 8\\).",
    difficulty_level: "EASY",
    subparts: [
      {
        question_type: "MCQ",
        question: "What is the mean?",
        options: ["\\(6\\)", "\\(5\\)", "\\(7\\)", "\\(8\\)"],
        correct_options: ["\\(6\\)"],
        solution: "\\(24 \\div 4 = 6\\).",
        hint: "Add the values and divide.",
      },
    ],
    language: "English",
    ct_key: "data_set_statistics_ct_011",
    question_no: 1,
  },
  FIB_SUBPART: {
    question_type: "FIB_SUBPART",
    question: [{ type: "text", text: "A leaf in sunlight.\n" }, image],
    difficulty_level: "MEDIUM",
    subparts: [
      {
        question_type: "FIB",
        question: "This process is called {placeholder1}.",
        placeholders: [
          {
            placeholder_id: 1,
            correct_keyword: "photosynthesis",
            incorrect_keywords: ["respiration", "transpiration", "digestion"],
          },
        ],
        solution: "It is photosynthesis.",
        hint: "The name refers to light.",
      },
    ],
    language: "English",
    ct_key: "photosynthesis_terms_ct_012",
    question_no: 1,
  },
  DROP_DOWN_SUBPART: {
    question_type: "DROP_DOWN_SUBPART",
    question: "A sealed rigid container of gas is heated.",
    difficulty_level: "MEDIUM",
    subparts: [
      {
        question_type: "DROP_DOWN",
        question: "The particles' average speed {placeholder1}.",
        placeholders: [
          {
            placeholder_id: 1,
            correct_keyword: "increases",
            incorrect_keywords: ["decreases", "stays the same", "becomes zero"],
          },
        ],
        solution: "Higher temperature means faster particles.",
        hint: "Relate temperature to kinetic energy.",
      },
    ],
    language: "English",
    ct_key: "heated_gas_behaviour_ct_013",
    question_no: 1,
  },
  TRUE_FALSE_SUBPART: {
    question_type: "TRUE_FALSE_SUBPART",
    question: "Decide whether each statement is true or false.",
    difficulty_level: "MEDIUM",
    subparts: [
      {
        question_type: "TRUE_FALSE",
        question: "\\(91\\) is a prime number.",
        correct_answer: false,
        solution: "\\(91 = 7 \\times 13\\).",
        hint: "Try dividing by small primes.",
      },
    ],
    language: "English",
    ct_key: "prime_number_statements_ct_014",
    question_no: 1,
  },
  DECIMAL_SUBPART: {
    question_type: "DECIMAL_SUBPART",
    question: "A car travels \\(150\\) km in \\(2.5\\) hours.",
    difficulty_level: "MEDIUM",
    subparts: [
      {
        question_type: "DECIMAL",
        question: "Find its average speed.",
        placeholders: [
          { placeholder_id: 1, value: 1.58, min_decimal_places: 2 },
        ],
        acceptance_tolerance: { lower: 0.005, upper: 0.005 },
        answers_interchangeable: false,
        answer_box: "Speed: {placeholder1} \\(\\text{km/h}\\)",
        solution: "\\(150 \\div 2.5 = 60\\).",
        hint: "Divide distance by time.",
        language: "English",
      },
    ],
    language: "English",
    ct_key: "average_speed_ct_015",
    question_no: 1,
  },
  MATH_EXPRESSION_SUBPART: {
    question_type: "MATH_EXPRESSION_SUBPART",
    question: "Let \\(P = 3(x + 4)\\) and \\(Q = 2x\\).",
    difficulty_level: "MEDIUM",
    subparts: [
      {
        question_type: "MATH_EXPRESSION",
        question: "Simplify \\(3x + 12 + 2x\\).",
        matching: "EXACT",
        placeholders: [
          {
            placeholder_id: 1,
            value: "\\(5x+12\\)",
            variables: ["x"],
            valid_alternatives: ["\\(5x + 12\\)"],
          },
        ],
        answers_interchangeable: false,
        answer_box: "{placeholder1}",
        solution: "\\(5x + 12\\).",
        hint: "Combine the terms in x.",
        language: "English",
      },
    ],
    language: "English",
    ct_key: "expanding_and_simplifying_ct_016",
    question_no: 1,
  },
  PATTERN_MATCH_SUBPART: {
    question_type: "PATTERN_MATCH_SUBPART",
    question: "Answer using correct chemical notation.",
    difficulty_level: "MEDIUM",
    subparts: [
      {
        question_type: "PATTERN_MATCH",
        question: "Write the symbol for potassium.",
        placeholders: [
          { placeholder_id: 1, value: "K", valid_examples: ["K"] },
        ],
        answer_box: "{placeholder1}",
        solution: "Potassium is \\(\\text{K}\\).",
        hint: "The symbol comes from the Latin name.",
        language: "English",
      },
    ],
    language: "English",
    ct_key: "potassium_chloride_notation_ct_017",
    question_no: 1,
  },
  HYBRID_SUBPART: {
    question_type: "HYBRID_SUBPART",
    question: [{ type: "text", text: "A cylinder.\n" }, image],
    difficulty_level: "MEDIUM",
    subparts: [
      {
        question_type: "MTC",
        question: "Match each quantity with its value.",
        matches: [
          {
            left: "Radius",
            right: "\\(3\\) cm",
            hint: "Halve the diameter.",
            explanation: "Half of \\(6\\) cm.",
          },
        ],
        hint: "Use the formulas for the circle and the cylinder.",
      },
      {
        question_type: "DECIMAL",
        question: "Find the volume to one decimal place.",
        placeholders: [
          { placeholder_id: 1, value: 282.6, min_decimal_places: 1 },
        ],
        acceptance_tolerance: { lower: 0.05, upper: 0.05 },
        answers_interchangeable: false,
        answer_box: "Volume: {placeholder1} \\(\\text{cm}^3\\)",
        solution: "\\(V \\approx 282.6\\).",
        hint: "Multiply the base area by the height.",
        language: "English",
      },
      {
        question_type: "MATH_EXPRESSION",
        question: "Write the volume in terms of \\(\\pi\\) and \\(h\\).",
        matching: "EQUIVALENT",
        placeholders: [
          {
            placeholder_id: 1,
            value: "\\(9\\pi h\\)",
            variables: ["h"],
            valid_alternatives: [],
          },
        ],
        answers_interchangeable: false,
        answer_box: "\\(V =\\) {placeholder1}",
        solution: "\\(V = 9\\pi h\\).",
        hint: "Substitute the radius.",
        language: "English",
      },
      {
        question_type: "FIB",
        question: "A cylinder has {placeholder1} flat faces.",
        placeholders: [
          {
            placeholder_id: 1,
            correct_keyword: "2",
            incorrect_keywords: ["1", "3", "0"],
          },
        ],
        solution: "Two flat circular faces.",
        hint: "Count the top and the bottom.",
      },
      {
        question_type: "TRUE_FALSE",
        question: "Doubling the radius doubles the volume.",
        correct_answer: false,
        solution: "Volume depends on \\(r^2\\).",
        hint: "Look at the power of r.",
      },
    ],
    language: "English",
    ct_key: "cylinder_geometry_ct_018",
    question_no: 1,
  },
} satisfies { [K in QuestionTypeId]: QuestionByType[K] };

// A topic as the platform's generator may store it: no topic_name, no ct_key, positional set.
const GENERATED_TOPIC = {
  topic_id: "0c7a4f0e-1111-4222-8333-944455556666",
  cts: [
    {
      key: "fractions_ct_001",
      difficulty_level: "EASY",
      variations: [
        {
          question_type: "TRUE_FALSE",
          question: "\\(\\tfrac{1}{2} > \\tfrac{1}{3}\\).",
          difficulty_level: "EASY",
          correct_answer: true,
          solution: "Halves are bigger than thirds.",
          hint: "Compare the denominators.",
          language: "English",
          question_no: 1,
        },
      ],
    },
    {
      key: "legacy_ct_002",
      difficulty_level: "HARD",
      source: "legacy import",
      variations: [
        {
          question_type: "MTC",
          difficulty_level: "HARD",
          matches: [
            { left: "A", right: "1", hint: "Count.", explanation: "" },
            { left: "B", right: "2", hint: "Count again." },
          ],
        },
      ],
    },
  ],
  owner: "extra keys are kept",
} satisfies Topic;

// ------------------------------------------------------------------ helpers

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Every path in a JSON value with the kind of value found there. Array items are tagged by their
 * `question_type` (parts) or `type` (content segments), so parts of different types and text vs
 * media segments are told apart.
 */
function shapeOf(value: unknown, path = "$", out = new Set<string>()) {
  if (Array.isArray(value)) {
    out.add(`${path}:array`);
    for (const item of value) {
      const tag = !isObject(item)
        ? ""
        : typeof item.question_type === "string"
          ? item.question_type
          : typeof item.type === "string"
            ? item.type
            : "";
      shapeOf(item, `${path}[${tag}]`, out);
    }
  } else if (isObject(value)) {
    out.add(`${path}:object`);
    for (const [key, item] of Object.entries(value)) {
      shapeOf(item, `${path}.${key}`, out);
    }
  } else {
    out.add(`${path}:${value === null ? "null" : typeof value}`);
  }
  return out;
}

const sorted = (values: Iterable<string>) => [...values].sort();

/** A short, type-specific summary, written as an exhaustive switch over every type. */
function answerSummary(question: TopicQuestion): string {
  switch (question.question_type) {
    case "MCQ":
      return `${question.correct_options.length} of ${question.options.length} options`;
    case "OPEN_ENDED":
      return "written";
    case "TRUE_FALSE":
      return question.correct_answer ? "true" : "false";
    case "FIB":
    case "DROP_DOWN":
      return question.placeholders
        .map((p) =>
          typeof p.correct_keyword === "string" ? p.correct_keyword : "?",
        )
        .join(" | ");
    case "MTC":
      return `${question.matches.length} pairs`;
    case "DECIMAL":
      return `${question.placeholders.map((p) => p.value).join(", ")} ±${question.acceptance_tolerance.upper}`;
    case "MATH_EXPRESSION":
      return `${question.matching} ${question.placeholders.map((p) => p.value).join(", ")}`;
    case "PATTERN_MATCH":
      return question.placeholders.map((p) => p.value).join(", ");
    case "OPEN_ENDED_SUBPART":
    case "MCQ_SUBPART":
    case "FIB_SUBPART":
    case "DROP_DOWN_SUBPART":
    case "TRUE_FALSE_SUBPART":
    case "HYBRID_SUBPART":
    case "DECIMAL_SUBPART":
    case "MATH_EXPRESSION_SUBPART":
    case "PATTERN_MATCH_SUBPART":
      return question.subparts.map((part) => part.question_type).join(" + ");
    default: {
      const unreachable: never = question;
      return unreachable;
    }
  }
}

// ------------------------------------------------------------------ tests

describe("type ids and registry", () => {
  it("lists the 9 single and 9 multi-part types in the skill's order", () => {
    expect(QUESTION_TYPE_IDS).toEqual([
      ...BASE_QUESTION_TYPE_IDS,
      ...SUBPART_TYPE_IDS,
    ]);
    expect(BASE_QUESTION_TYPE_IDS).toHaveLength(9);
    expect(SUBPART_TYPE_IDS).toHaveLength(9);
    expect(new Set(QUESTION_TYPE_IDS).size).toBe(18);
    expect(DIFFICULTY_LEVELS).toEqual(["EASY", "MEDIUM", "HARD"]);
  });

  it("has one entry per type, keyed and ordered like QUESTION_TYPE_IDS", () => {
    expect(Object.keys(QUESTION_TYPES)).toEqual([...QUESTION_TYPE_IDS]);
    for (const id of QUESTION_TYPE_IDS) {
      const info = QUESTION_TYPES[id];
      expect(info.id).toBe(id);
      expect(info.label.trim()).not.toBe("");
      expect(info.description.trim()).not.toBe("");
      expect(info.subpart).toBe(isSubpartType(id));
      expect(info.family === "multipart").toBe(info.subpart);
    }
    const labels = QUESTION_TYPE_IDS.map((id) => QUESTION_TYPES[id].label);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it("names each multi-part type's part type", () => {
    for (const id of SUBPART_TYPE_IDS) {
      const expected =
        id === "HYBRID_SUBPART" ? "mixed" : id.replace(/_SUBPART$/, "");
      expect(QUESTION_TYPES[id].partType).toBe(expected);
    }
    for (const id of BASE_QUESTION_TYPE_IDS) {
      expect(QUESTION_TYPES[id].partType).toBeUndefined();
    }
  });

  it("groups the types into families", () => {
    const family = (id: QuestionTypeId) => QUESTION_TYPES[id].family;
    expect(family("MCQ")).toBe("choice");
    expect(family("TRUE_FALSE")).toBe("choice");
    expect(family("FIB")).toBe("blanks");
    expect(family("DROP_DOWN")).toBe("blanks");
    expect(family("MTC")).toBe("matching");
    expect(family("OPEN_ENDED")).toBe("text");
    for (const id of ANSWER_BOX_TYPE_IDS) expect(family(id)).toBe("answer_box");
  });

  it("uses icon names that lucide-react exports", () => {
    for (const id of QUESTION_TYPE_IDS) {
      const icon = QUESTION_TYPES[id].icon;
      expect(icon, id).toBeDefined();
      expect(
        lucide[icon as keyof typeof lucide],
        `${id}: ${icon}`,
      ).toBeDefined();
    }
  });

  it("recognises type ids", () => {
    expect(isQuestionType("MCQ")).toBe(true);
    expect(isQuestionType("HYBRID_SUBPART")).toBe(true);
    expect(isQuestionType("SUBPART")).toBe(false);
    expect(isQuestionType("mcq")).toBe(false);
    expect(isQuestionType(undefined)).toBe(false);
    expect(isQuestionType(7)).toBe(false);
    expect(isSubpartType("DECIMAL_SUBPART")).toBe(true);
    expect(isSubpartType("DECIMAL")).toBe(false);
    expect(isBaseQuestionType("PATTERN_MATCH")).toBe(true);
    expect(isBaseQuestionType("PATTERN_MATCH_SUBPART")).toBe(false);
    expect(questionTypeInfo("MTC")?.label).toBe("Match the columns");
    expect(questionTypeInfo("ESSAY")).toBeUndefined();
  });
});

describe("all_types.json (the skill's example: one set per type)", () => {
  const reading = readTopicQuestions(allTypes);

  it("recognises every question of every set", () => {
    expect(reading.unknown).toEqual([]);
    expect(reading.questions).toHaveLength(27);
    const sets = (allTypes as Topic).cts;
    expect(sets).toHaveLength(18);
    sets.forEach((ct, setIndex) => {
      const found = reading.questions.filter((q) => q.setIndex === setIndex);
      expect(found).toHaveLength(ct.variations.length);
      for (const entry of found) {
        expect(entry.ctKey).toBe(ct.key);
        expect(QUESTION_TYPES[entry.question.question_type]).toBeDefined();
        expect(entry.questionNo).toBe(entry.question.question_no);
      }
    });
  });

  it("uses each of the 18 types in exactly one set", () => {
    const typeOfSet = new Map<number, Set<string>>();
    for (const { setIndex, question } of reading.questions) {
      const types = typeOfSet.get(setIndex) ?? new Set<string>();
      types.add(question.question_type);
      typeOfSet.set(setIndex, types);
    }
    const types = [...typeOfSet.values()].map((t) => {
      expect(t.size).toBe(1);
      return [...t][0];
    });
    expect(types).toEqual([...QUESTION_TYPE_IDS]);
  });

  it("counts the types", () => {
    const single = BASE_QUESTION_TYPE_IDS.map((type) => ({
      type,
      label: QUESTION_TYPES[type].label,
      sets: 1,
      questions: 2,
    }));
    const multi = SUBPART_TYPE_IDS.map((type) => ({
      type,
      label: QUESTION_TYPES[type].label,
      sets: 1,
      questions: 1,
    }));
    expect(questionTypeCounts(allTypes)).toEqual([...single, ...multi]);
    expect(questionTypeCounts(allTypes).slice(0, 3)).toEqual([
      { type: "MCQ", label: "Multiple choice", sets: 1, questions: 2 },
      { type: "OPEN_ENDED", label: "Written answer", sets: 1, questions: 2 },
      { type: "TRUE_FALSE", label: "True or false", sets: 1, questions: 2 },
    ]);
  });

  it("has exactly the structure of the typed samples, type by type", () => {
    for (const id of QUESTION_TYPE_IDS) {
      const seen = new Set<string>();
      for (const { question } of reading.questions) {
        if (question.question_type === id) shapeOf(question, "$", seen);
      }
      expect(sorted(seen), id).toEqual(sorted(shapeOf(SAMPLES[id])));
    }
  });

  it("holds parts of the declared part type, and hybrids of two or more", () => {
    for (const { question } of reading.questions) {
      if (!isMultipartQuestion(question)) {
        expect(isSubpartType(question.question_type)).toBe(false);
        continue;
      }
      const partType = QUESTION_TYPES[question.question_type].partType;
      const types = question.subparts.map((part) => part.question_type);
      expect(types.every(isBaseQuestionType)).toBe(true);
      if (partType === "mixed") {
        expect(new Set(types).size).toBeGreaterThanOrEqual(2);
      } else {
        expect(new Set(types)).toEqual(new Set([partType]));
      }
    }
  });

  it("narrows questions and parts by type", () => {
    const summaries = reading.questions
      .filter(({ questionIndex }) => questionIndex === 0)
      .map(({ question }) => answerSummary(question));
    expect(summaries).toEqual([
      "2 of 4 options",
      "written",
      "true",
      "100",
      "NaCl",
      "2 pairs",
      "5 ±0",
      "EQUIVALENT \\((x+1)^2\\)",
      "Na",
      "OPEN_ENDED + OPEN_ENDED + OPEN_ENDED",
      "MCQ + MCQ + MCQ",
      "FIB + FIB",
      "DROP_DOWN + DROP_DOWN",
      "TRUE_FALSE + TRUE_FALSE + TRUE_FALSE",
      "DECIMAL + DECIMAL",
      "MATH_EXPRESSION + MATH_EXPRESSION",
      "PATTERN_MATCH + PATTERN_MATCH",
      "MTC + DECIMAL + MATH_EXPRESSION + FIB + TRUE_FALSE",
    ]);

    for (const { question } of reading.questions) {
      for (const id of QUESTION_TYPE_IDS) {
        expect(isQuestionOfType(question, id)).toBe(
          question.question_type === id,
        );
      }
    }

    const hybrid = reading.questions
      .map(({ question }) => question)
      .find((q): q is HybridSubpart => isQuestionOfType(q, "HYBRID_SUBPART"));
    expect(hybrid).toBeDefined();
    const parts = hybrid?.subparts ?? [];
    const decimal = parts.find((p) => isPartOfType(p, "DECIMAL"));
    expect(decimal && isPartOfType(decimal, "DECIMAL")).toBe(true);
    if (decimal && isPartOfType(decimal, "DECIMAL")) {
      expect(decimal.acceptance_tolerance).toEqual({
        lower: 0.05,
        upper: 0.05,
      });
      expect(decimal.language).toBe("English");
    }
    const mtc = parts.find((p): p is MtcPart => isPartOfType(p, "MTC"));
    expect(mtc?.hint).toBe("Use the formulas for the circle and the cylinder.");
    expect(mtc?.matches.every((m) => typeof m.explanation === "string")).toBe(
      true,
    );
  });
});

describe("readTopicQuestions and questionTypeCounts on untrusted input", () => {
  it("returns nothing for values that aren't topics", () => {
    for (const value of [
      null,
      undefined,
      42,
      "topic",
      true,
      [],
      [{ cts: [] }],
    ]) {
      expect(readTopicQuestions(value)).toEqual({ questions: [], unknown: [] });
      expect(questionTypeCounts(value)).toEqual([]);
    }
  });

  it("returns nothing when cts is missing or not a list", () => {
    for (const value of [{}, { topic_id: "x" }, { cts: {} }, { cts: "x" }]) {
      expect(readTopicQuestions(value)).toEqual({ questions: [], unknown: [] });
      expect(questionTypeCounts(value)).toEqual([]);
    }
  });

  it("skips sets that aren't objects or have no variations list", () => {
    const topic = {
      cts: [null, 5, "set", { key: "a" }, { key: "b", variations: "x" }],
    };
    expect(readTopicQuestions(topic)).toEqual({ questions: [], unknown: [] });
  });

  it("reports unknown, missing and non-object questions without throwing", () => {
    const mcq = SAMPLES.MCQ;
    const topic = {
      topic_id: "t",
      cts: [
        {
          key: "set_one_ct_001",
          variations: [
            { question_type: "ESSAY", question: "Write about it." },
            { question: "No type." },
            null,
            "MCQ",
            { question_type: 7 },
            { question_type: "SUBPART", subparts: [] },
            mcq,
          ],
        },
      ],
    };
    const reading = readTopicQuestions(topic);
    expect(reading.questions).toEqual([
      {
        setIndex: 0,
        ctKey: "set_one_ct_001",
        questionIndex: 6,
        questionNo: 1,
        question: mcq,
      },
    ]);
    expect(
      reading.unknown.map(({ questionIndex, questionType, reason }) => ({
        questionIndex,
        questionType,
        reason,
      })),
    ).toEqual([
      { questionIndex: 0, questionType: "ESSAY", reason: "unknown_type" },
      { questionIndex: 1, questionType: undefined, reason: "missing_type" },
      { questionIndex: 2, questionType: undefined, reason: "not_an_object" },
      { questionIndex: 3, questionType: undefined, reason: "not_an_object" },
      { questionIndex: 4, questionType: undefined, reason: "missing_type" },
      { questionIndex: 5, questionType: "SUBPART", reason: "unknown_type" },
    ]);
    expect(reading.unknown.every((u) => u.ctKey === "set_one_ct_001")).toBe(
      true,
    );
    expect(questionTypeCounts(topic)).toEqual([
      { type: "MCQ", label: "Multiple choice", sets: 1, questions: 1 },
    ]);
  });

  it("reads a generated topic: no topic_name, no ct_key, legacy positional set", () => {
    const reading = readTopicQuestions(GENERATED_TOPIC);
    expect(reading.unknown).toEqual([]);
    expect(
      reading.questions.map(
        ({ setIndex, ctKey, questionIndex, questionNo }) => ({
          setIndex,
          ctKey,
          questionIndex,
          questionNo,
        }),
      ),
    ).toEqual([
      {
        setIndex: 0,
        ctKey: "fractions_ct_001",
        questionIndex: 0,
        questionNo: 1,
      },
      {
        setIndex: 1,
        ctKey: "legacy_ct_002",
        questionIndex: 0,
        questionNo: undefined,
      },
    ]);
    expect(questionTypeCounts(GENERATED_TOPIC)).toEqual([
      { type: "TRUE_FALSE", label: "True or false", sets: 1, questions: 1 },
      { type: "MTC", label: "Match the columns", sets: 1, questions: 1 },
    ]);
  });

  it("takes the question's ct_key only when the set has no key", () => {
    const question = { ...SAMPLES.OPEN_ENDED, question_no: 0 };
    const topic = {
      cts: [
        { variations: [question] },
        { key: "", variations: [{ ...question, ct_key: undefined }] },
        { key: "set_ct_003", variations: [question] },
      ],
    };
    const reading = readTopicQuestions(topic);
    expect(reading.questions.map((q) => q.ctKey)).toEqual([
      "odd_even_proofs_ct_002",
      undefined,
      "set_ct_003",
    ]);
    expect(reading.questions.map((q) => q.questionNo)).toEqual([
      undefined,
      undefined,
      undefined,
    ]);
  });

  it("counts sets once per type and keeps QUESTION_TYPE_IDS order", () => {
    const topic = {
      cts: [
        { key: "a", variations: [SAMPLES.HYBRID_SUBPART, SAMPLES.DECIMAL] },
        { key: "b", variations: [SAMPLES.DECIMAL, SAMPLES.DECIMAL] },
        { key: "c", variations: [SAMPLES.MCQ, { question_type: "ESSAY" }] },
      ],
    };
    expect(questionTypeCounts(topic)).toEqual([
      { type: "MCQ", label: "Multiple choice", sets: 1, questions: 1 },
      { type: "DECIMAL", label: "Typed number", sets: 2, questions: 3 },
      {
        type: "HYBRID_SUBPART",
        label: "Mixed types in parts",
        sets: 1,
        questions: 1,
      },
    ]);
  });
});
