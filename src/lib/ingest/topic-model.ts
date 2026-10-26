/**
 * The TopicCrafter topic, typed: one interface per question type.
 *
 * A topic file (`<topic_name>.json`) is what the TopicCrafter skill's parser writes from the
 * creator's topic `.md`, and what Ingester mode uploads. This module describes that JSON exactly,
 * so the UI can render (and later animate) each question type on its own. Field names are the
 * backend's (snake_case), unchanged.
 *
 * Source of truth, in the skill (`skills/topic-crafter/`, vendored from the backend). When this
 * file and those disagree, they win; update this file:
 * - `qc_models/question_models.py`: the pydantic models (`OpenEnded`, `MCQ`, `FIB`, `DROP_DOWN`,
 *   `TrueFalse`, `MTC`, `DECIMAL`, `MATH_EXPRESSION`, `PATTERN_MATCH` and the `*Subpart` parents).
 * - `qc_models/algorithmic_verifier.py`: system fields and hints required on top of the models.
 * - `scripts/topic_parser.py`, `references/json_mapping.md`: what the parser writes.
 * - `scripts/topic_validator.py`: topic-level rules (ids, set difficulty, one language).
 *
 * Shape:
 *
 *     Topic       { topic_id, topic_name?, cts: TopicCt[] }
 *     TopicCt     { key, difficulty_level, variations: TopicQuestion[] }   // a "question set" (CT)
 *     TopicQuestion, discriminated on `question_type` (18 types, see QUESTION_TYPE_IDS):
 *       9 single types       MCQ, OPEN_ENDED, TRUE_FALSE, FIB, DROP_DOWN, MTC,
 *                            DECIMAL, MATH_EXPRESSION, PATTERN_MATCH
 *       9 multi-part types   <BASE>_SUBPART (every part is that base type) and
 *                            HYBRID_SUBPART (parts of at least two base types).
 *                            Their `subparts[]` hold parts (QuestionPart) of the 9 single types.
 *
 * "Required" below means the platform rejects a question without it (the model or the platform
 * verifier says so); "optional" fields may be left out. The types describe a valid topic.
 * `readTopicQuestions` reads files that nobody has checked yet and only trusts `question_type`,
 * so UI code must still cope with a missing or malformed field.
 *
 * No runtime dependencies: types, small constant tables and guards.
 */

// ------------------------------------------------------------------------------- type ids

/**
 * The nine single question types, in the skill's order (`BASE_TYPES` in topic_parser.py). They
 * are also the only types a part of a multi-part question can have.
 */
export const BASE_QUESTION_TYPE_IDS = [
  "MCQ",
  "OPEN_ENDED",
  "TRUE_FALSE",
  "FIB",
  "DROP_DOWN",
  "MTC",
  "DECIMAL",
  "MATH_EXPRESSION",
  "PATTERN_MATCH",
] as const;

/** A single (non-multi-part) question type; also the type of a part. */
export type BaseQuestionTypeId = (typeof BASE_QUESTION_TYPE_IDS)[number];

/**
 * The nine multi-part ("subpart") question types, in the skill's order. A question of one of
 * these types is one shared context (`question`) followed by parts (`subparts`). The parent
 * carries the type name; each part carries its own base type (`MCQ_SUBPART` -> parts are `MCQ`).
 */
export const SUBPART_TYPE_IDS = [
  "OPEN_ENDED_SUBPART",
  "MCQ_SUBPART",
  "FIB_SUBPART",
  "DROP_DOWN_SUBPART",
  "TRUE_FALSE_SUBPART",
  "DECIMAL_SUBPART",
  "MATH_EXPRESSION_SUBPART",
  "PATTERN_MATCH_SUBPART",
  "HYBRID_SUBPART",
] as const;

/** A multi-part question type (a subset of QuestionTypeId). */
export type SubpartTypeId = (typeof SUBPART_TYPE_IDS)[number];

/**
 * Every `question_type` a question in `variations` can have: the 9 single types, then the 9
 * multi-part types (`ALL_TYPES` in topic_parser.py). The backend enum's generic `SUBPART` value
 * is not here: the generator resolves it to a specific type before a question is stored, and no
 * model accepts it.
 */
export const QUESTION_TYPE_IDS = [
  ...BASE_QUESTION_TYPE_IDS,
  ...SUBPART_TYPE_IDS,
] as const;

/** The `question_type` of a question in a set: a single type or a multi-part type. */
export type QuestionTypeId = (typeof QUESTION_TYPE_IDS)[number];

/**
 * The typed answer-box types. They share a strict contract (`_StrictAnswerBoxQuestion`):
 * unknown fields are rejected, `language` is required, `difficulty_level` is optional, and the
 * learner types each answer into a box marked in `answer_box`.
 */
export const ANSWER_BOX_TYPE_IDS = [
  "DECIMAL",
  "MATH_EXPRESSION",
  "PATTERN_MATCH",
] as const;

/** A typed answer-box type. */
export type AnswerBoxTypeId = (typeof ANSWER_BOX_TYPE_IDS)[number];

// ------------------------------------------------------------------------------- shared values

/** The three difficulty levels, easiest first. */
export const DIFFICULTY_LEVELS = ["EASY", "MEDIUM", "HARD"] as const;

/** A question set's difficulty (Python `DifficultyLevel`). */
export type DifficultyLevel = (typeof DIFFICULTY_LEVELS)[number];

/**
 * The 22 language names a topic may use (`SUPPORTED_LANGUAGES` in topic_parser.py), written
 * exactly like this. A topic has one language (v1); the validator reports any other name.
 */
export const SUPPORTED_LANGUAGES = [
  "English",
  "Arabic",
  "Hindi",
  "Traditional Chinese",
  "Vietnamese",
  "Bahasa",
  "Japanese",
  "Filipino",
  "Uzbek",
  "Russian",
  "Azerbaijani",
  "Kyrgyzstan",
  "Korean",
  "Malay",
  "Cebuano",
  "Hiligaynon",
  "Ilocano",
  "Waray",
  "Spanish",
  "Portuguese (Portugal)",
  "French",
  "Tamil",
] as const;

/** One of SUPPORTED_LANGUAGES. Fields typed `string` accept any name; valid topics use these. */
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];

/** How a MATH_EXPRESSION answer is compared with `value` / `valid_alternatives`. */
export const MATH_EXPRESSION_MATCHING = ["EXACT", "EQUIVALENT"] as const;

/**
 * `EXACT`: the learner's expression must have the written form of `value` or an alternative (use
 * it when the form is assessed: factorised, simplified). `EQUIVALENT`: any mathematically equal
 * expression is right.
 */
export type MathExpressionMatching = (typeof MATH_EXPRESSION_MATCHING)[number];

// ------------------------------------------------------------------------------- content

/**
 * A run of text inside a content value (Python `TextSegment`). Like a plain string value, it is
 * plain text with LaTeX, not Markdown.
 */
export interface TextSegment {
  type: "text";
  /** The text. Line breaks are `\n`. */
  text: string;
}

/**
 * A picture inside a content value (Python `MediaSegment`). The parser makes one from
 * `![description](url)` in the topic `.md`.
 *
 * Cerebry topics may only show images (`media_type: "image"`), and only from links created on
 * the Cerebry platform. The model itself accepts other media types.
 */
export interface MediaSegment {
  type: "media";
  /**
   * `"image"` in every Cerebry topic. The model accepts any string (e.g. `"audio"`, `"video"`,
   * `"image[png]"`); the parser writes a Markdown image title here when one is given, which the
   * skill forbids.
   */
  media_type: string;
  /** The media link (a public URL; the model also accepts a base64 data URL). */
  url: string;
  /** What the picture shows (the Markdown alt text). The parser omits it when the alt text is empty. */
  description?: string | null;
  /** A unique name for the media; never written by the parser. */
  name?: string | null;
  /** Whether a text reference to this media is kept (model default false); never written by the parser. */
  persist_media_reference?: boolean | null;
  /** MIME type; when absent the backend derives it from the URL or `media_type`. */
  mime_type?: string | null;
}

/** One segment of a multimodal content value. */
export type ContentSegment = TextSegment | MediaSegment;

/**
 * Text interleaved with pictures (Python `MultimodalContent`, a list of segments). The parser
 * writes a field this way only when its text contains an image; otherwise the field is a plain
 * string.
 */
export type MultimodalContent = ContentSegment[];

/**
 * The value of a text field (question, solution, hint, answer box, option, keyword, match side):
 * a plain string, or text interleaved with images (Python `Union[str, MultimodalContent]`).
 *
 * Text is plain text plus LaTeX in `\( \)`, `\[ \]` or `$$ $$` with single backslashes; no
 * Markdown emphasis or headings. The platform checks every text field's LaTeX: delimiters
 * balanced, not nested, no line break inside `\( \)`, and `\text{}` only inside maths.
 */
export type RichContent = string | MultimodalContent;

// ------------------------------------------------------------------------------- identity and envelopes

/**
 * Where a question sits in its question set (Python `QuestionIdentity`). The parser writes both
 * on every top-level question; real topics may lack them (see each field). Parts of a multi-part
 * question never get them from the parser and should leave them out.
 */
export interface QuestionIdentity {
  /**
   * The variant number (`### Variant <n>` in the `.md`): an integer >= 1, unique in its set. It
   * is an ID, not a position: a set may have gaps (a deleted variant) and any order. Either every
   * question of a set has one or none does; legacy "positional" sets have none and are addressed
   * by list order (1-based).
   */
  question_no?: number;
  /**
   * The key of the question's set, copied from `TopicCt.key`; when present it must equal it.
   * Often absent: the platform's own generator stores topics without it ("no-ct-key" sets).
   */
  ct_key?: string;
}

/**
 * The envelope of a top-level question of a single type that is not a typed answer-box type, and
 * of the multi-part parents other than DECIMAL/MATH_EXPRESSION/PATTERN_MATCH_SUBPART.
 */
export interface QuestionEnvelope extends QuestionIdentity {
  /**
   * The set's difficulty, copied into every question; must equal `TopicCt.difficulty_level`.
   * Required by the platform verifier for these types.
   */
  difficulty_level: DifficultyLevel;
  /**
   * The topic's language (see SUPPORTED_LANGUAGES). The parser always writes it on top-level
   * questions; the model doesn't require it here (hint punctuation then assumes English).
   */
  language?: string;
}

/**
 * The envelope of a part (an item of `subparts`) of a single type that is not a typed answer-box
 * type. Parts inherit difficulty, identity and language from their parent: the parser writes
 * none of these (only `language`, when the part has its own `- Language:` line). The model
 * tolerates them, but `difficulty_level` on a part draws a validator warning.
 */
export interface PartEnvelope extends QuestionIdentity {
  /** Leave out: a part takes the parent's difficulty (the validator warns when present). */
  difficulty_level?: DifficultyLevel;
  /** Only when the part's language differs from the topic's (`- Language:` line under the part). */
  language?: string;
}

// ------------------------------------------------------------------------------- the classic single types

/**
 * Question, solution and hint, as every classic single type has them (Python `OpenEnded`: the
 * base question with a required hint). Unknown extra fields are ignored by these models.
 */
export interface QuestionTextFields {
  /** What the learner reads. Required, not blank. */
  question: RichContent;
  /** The full worked solution. Required, not blank. */
  solution: RichContent;
  /**
   * A nudge toward the method. Required, not blank, one line (no line breaks), a statement (must
   * not end with "?") ending with the language's full stop ("." in English, "।" in Hindi,
   * "。" in Japanese and Traditional Chinese).
   */
  hint: RichContent;
}

/**
 * OPEN_ENDED fields (Python `OpenEnded`): the learner writes their own answer (an explanation, a
 * proof, a worked calculation). There is no answer key; `solution` is the model answer.
 */
export interface OpenEndedFields extends QuestionTextFields {
  question_type: "OPEN_ENDED";
}

/** A free-response (written answer) question in a set. */
export interface OpenEndedQuestion extends OpenEndedFields, QuestionEnvelope {}

/** A free-response part of OPEN_ENDED_SUBPART or HYBRID_SUBPART. */
export interface OpenEndedPart extends OpenEndedFields, PartEnvelope {}

/**
 * MCQ fields (Python `MCQ`): the learner picks from `options`. The platform shuffles and numbers
 * the options itself (no "A." prefixes in the text) and marks the question right when the
 * learner picks exactly the `correct_options`. Several correct options make it a multiple-select
 * question (the stem then says "Select all that apply.").
 */
export interface McqFields extends QuestionTextFields {
  question_type: "MCQ";
  /** The choices, in authored order: at least 2 (4 by default), none blank, no two equal. */
  options: RichContent[];
  /**
   * The right choices: at least 1, each a copy of one of `options` (matched by text, in option
   * order as the parser writes them). The platform repairs a copy that differs only in spacing,
   * trailing punctuation or letter case when exactly one option matches; otherwise the question
   * is rejected.
   */
  correct_options: RichContent[];
}

/** A multiple-choice question in a set. */
export interface McqQuestion extends McqFields, QuestionEnvelope {}

/** A multiple-choice part of MCQ_SUBPART or HYBRID_SUBPART. */
export interface McqPart extends McqFields, PartEnvelope {}

/**
 * TRUE_FALSE fields (Python `TrueFalse`): the learner judges one statement. The platform shows
 * True and False in a shuffled order and appends the verdict to the solution.
 */
export interface TrueFalseFields extends QuestionTextFields {
  question_type: "TRUE_FALSE";
  /** Whether the statement in `question` is true. */
  correct_answer: boolean;
}

/** A true-or-false question in a set. */
export interface TrueFalseQuestion extends TrueFalseFields, QuestionEnvelope {}

/** A true-or-false part of TRUE_FALSE_SUBPART or HYBRID_SUBPART. */
export interface TrueFalsePart extends TrueFalseFields, PartEnvelope {}

/**
 * One blank of a FIB or DROP_DOWN question (Python `Placeholder`). The blank's place is the token
 * `{placeholder<placeholder_id>}` in `question`: single braces, lowercase, no spaces
 * (`{placeholder1}`, `{placeholder2}`, ...).
 */
export interface KeywordPlaceholder {
  /**
   * The blank's number: a positive integer. The ids of a question are exactly 1..N with no
   * duplicates (any list order), and each one's token appears in `question`, which has no other
   * tokens.
   */
  placeholder_id: number;
  /**
   * Optional presentation metadata (`- Type:` under the placeholder in the `.md`). Rare; the
   * serializer drops it when null.
   */
  placeholder_type?: string | null;
  /** The keyword that makes the blank right. */
  correct_keyword: RichContent;
  /**
   * The distractors (usually 3). The model defaults it to `[]` when absent; the parser always
   * writes it.
   */
  incorrect_keywords?: RichContent[];
}

/**
 * FIB fields (Python `FIB`), "fill in the blanks (drag and drop)": the platform shows a bank of
 * keywords (every blank's correct keyword plus its distractors) and the learner drags them into
 * the blanks in `question`. Each blank is right when it holds its `correct_keyword`.
 */
export interface FibFields extends QuestionTextFields {
  question_type: "FIB";
  /** The blanks: at least 1, ids 1..N, one per `{placeholderN}` token in `question`. */
  placeholders: KeywordPlaceholder[];
}

/** A fill-in-the-blanks (drag and drop) question in a set. */
export interface FibQuestion extends FibFields, QuestionEnvelope {}

/** A fill-in-the-blanks part of FIB_SUBPART or HYBRID_SUBPART. */
export interface FibPart extends FibFields, PartEnvelope {}

/**
 * One blank of a DROP_DOWN question: a KeywordPlaceholder whose keywords are plain strings, with
 * no LaTeX (`\(`, `\)`, `\[`, `\]`, `$$` or any `\command`) and no images.
 */
export interface DropDownPlaceholder extends KeywordPlaceholder {
  /** The right choice: plain text, not blank. */
  correct_keyword: string;
  /**
   * The other choices in this blank's menu (3 by default): plain text, not blank, distinct after
   * trimming spaces, and never the correct keyword.
   */
  incorrect_keywords?: string[];
}

/**
 * DROP_DOWN fields (Python `DROP_DOWN`, a FIB with menus): each blank in `question` is its own
 * dropdown menu holding that blank's correct keyword and distractors. All FIB rules apply.
 */
export interface DropDownFields extends QuestionTextFields {
  question_type: "DROP_DOWN";
  /** The blanks: at least 1, ids 1..N, one per `{placeholderN}` token in `question`. */
  placeholders: DropDownPlaceholder[];
}

/** A dropdown-blanks question in a set. */
export interface DropDownQuestion extends DropDownFields, QuestionEnvelope {}

/** A dropdown-blanks part of DROP_DOWN_SUBPART or HYBRID_SUBPART. */
export interface DropDownPart extends DropDownFields, PartEnvelope {}

/** One row of a match-the-columns question (Python `Match`). */
export interface MtcMatch {
  /** The left-column entry (2–3 words is the guidance). Not blank; unique across the matches. */
  left: RichContent;
  /** The right-column entry that pairs with `left`. Not blank; unique across the matches. */
  right: RichContent;
  /**
   * This row's hint. Required (the model rejects a match without one): not blank, one line, a
   * statement ending with the language's full stop. It points to the method without naming
   * `right`.
   */
  hint: RichContent;
  /**
   * Why the pair belongs together. Optional in the model, but the platform's topic preview needs
   * the key on every match (the validator warns when it is missing or blank), so real topics
   * carry it, sometimes as `""`.
   */
  explanation?: RichContent | null;
}

/**
 * MTC fields (Python `MTC`), "match the columns": the learner pairs each left entry with one
 * right entry. The platform shuffles the right column and checks every pair. Unlike the other
 * types, question, solution and hint are optional; the hints live on the matches.
 */
export interface MtcFields {
  question_type: "MTC";
  /**
   * The relationship ("Match each organelle with its function.") or a passage ("MTC with
   * context"). Optional; not blank when present.
   */
  question?: RichContent | null;
  /** The rows, in authored order: at least 1 (4–6 is the guidance). */
  matches: MtcMatch[];
  /** Optional overall solution. */
  solution?: RichContent | null;
  /** Optional one-line hint for the whole question (required on an MTC part, see MtcPart). */
  hint?: RichContent | null;
}

/** A match-the-columns question in a set. */
export interface MtcQuestion extends MtcFields, QuestionEnvelope {}

/** A match-the-columns part of HYBRID_SUBPART. Every part needs its own hint, MTC included. */
export interface MtcPart extends MtcFields, PartEnvelope {
  /** Required on a part (platform verifier): one line, a statement ending with a full stop. */
  hint: RichContent;
}

// ------------------------------------------------------------------------------- the typed answer-box types

/**
 * Fields shared by DECIMAL, MATH_EXPRESSION and PATTERN_MATCH (Python `_StrictAnswerBoxQuestion`).
 * The model forbids unknown fields. The learner types each answer into a box: `answer_box` holds
 * the boxes as `{placeholderN}` tokens with labels and units around them, and `placeholders`
 * holds one answer per box.
 */
export interface AnswerBoxFields {
  /**
   * The stem. Required, not blank, and with no `{placeholderN}` tokens and no `____` blanks
   * (4 or more underscores): the boxes live only in `answer_box`.
   */
  question: RichContent;
  /**
   * Text around the boxes, e.g. `"\\(x =\\) {placeholder1}"` or `"Speed: {placeholder1} km/h"`.
   * Required, not blank; holds each token `{placeholder1}`..`{placeholderN}` exactly once, in
   * ascending order, and no others. Tokens stay outside LaTeX delimiters.
   */
  answer_box: RichContent;
  /** The full worked solution. Required, not blank. */
  solution: RichContent;
  /** Required, not blank, one line, a statement ending with the language's full stop. */
  hint: RichContent;
  /** The question's language (see SUPPORTED_LANGUAGES). Required, not blank, on parts too. */
  language: string;
  /** The set's difficulty. Optional for these types; the parser writes it on top-level questions. */
  difficulty_level?: DifficultyLevel;
}

/**
 * The accepted margin around every DECIMAL answer of one question (Python `AcceptanceTolerance`,
 * no other keys). An answer `a` for value `v` is right when `v - lower <= a <= v + upper`;
 * `0`/`0` means exact. Both are finite JSON numbers >= 0. Within one multi-part question, every
 * non-zero pair must be identical (exact parts are exempt).
 */
export interface AcceptanceTolerance {
  /** How far below the value an answer may be. */
  lower: number;
  /** How far above the value an answer may be. */
  upper: number;
}

/** One numeric answer of a DECIMAL question (Python `DecimalPlaceholder`, no other keys). */
export interface DecimalPlaceholder {
  /** The box's number: a JSON integer equal to its 1-based position in `placeholders`. */
  placeholder_id: number;
  /**
   * The right number: a finite JSON number (whole or decimal), no units or LaTeX. The backend
   * keeps `5` and `5.0` apart (integer vs float); JavaScript does not, so re-serialising a topic
   * here writes `5.0` as `5`.
   */
  value: number;
  /** The precision the question asks for: a JSON integer >= 0 (0 for whole numbers). */
  min_decimal_places: number;
}

/**
 * DECIMAL fields (Python `DECIMAL`), "typed number": the learner types a number into each box;
 * it is right when it equals `value`, or lies within `acceptance_tolerance` of it.
 */
export interface DecimalFields extends AnswerBoxFields {
  question_type: "DECIMAL";
  /** One per box, ids 1..N in list order (at least 1). */
  placeholders: DecimalPlaceholder[];
  /** The margin for every box of this question. */
  acceptance_tolerance: AcceptanceTolerance;
  /**
   * `true` when the boxes may be filled in any order (an unordered set, e.g. the two roots of a
   * quadratic). Must be `false` when there is one box.
   */
  answers_interchangeable: boolean;
}

/** A typed-number question in a set. */
export interface DecimalQuestion extends DecimalFields, QuestionIdentity {}

/**
 * A typed-number part of DECIMAL_SUBPART or HYBRID_SUBPART: same contract as DecimalQuestion,
 * `language` included. Box ids restart at 1 in every part. Identity fields and
 * `difficulty_level` should be left out (the parent has them).
 */
export interface DecimalPart extends DecimalFields, QuestionIdentity {}

/** One symbolic answer of a MATH_EXPRESSION question (Python `MathExpressionPlaceholder`, no other keys). */
export interface MathExpressionPlaceholder {
  /** The box's number: a JSON integer equal to its 1-based position in `placeholders`. */
  placeholder_id: number;
  /**
   * The right expression as LaTeX wrapped in exactly one delimiter pair (`\(...\)`, `\[...\]` or
   * `$$...$$`) with nothing outside it, no second pair inside, no `#`, and an expression inside.
   * Example: `"\\((x+1)^2\\)"`.
   */
  value: string;
  /** The symbols the expression uses (e.g. `["x"]`): distinct, not blank; `[]` when none. */
  variables: string[];
  /**
   * Other accepted forms (same LaTeX rule as `value`): distinct, never `value` itself; `[]` when
   * none.
   */
  valid_alternatives: string[];
}

/**
 * MATH_EXPRESSION fields (Python `MATH_EXPRESSION`), "typed expression": the learner types an
 * expression (an exact fraction, a surd, a term in pi) into each box; it is compared with `value`
 * and `valid_alternatives` as `matching` says.
 */
export interface MathExpressionFields extends AnswerBoxFields {
  question_type: "MATH_EXPRESSION";
  /** How answers are compared, for the whole question. */
  matching: MathExpressionMatching;
  /** One per box, ids 1..N in list order (at least 1). */
  placeholders: MathExpressionPlaceholder[];
  /** `true` when the boxes may be filled in any order; must be `false` when there is one box. */
  answers_interchangeable: boolean;
}

/** A typed-expression question in a set. */
export interface MathExpressionQuestion
  extends MathExpressionFields,
    QuestionIdentity {}

/**
 * A typed-expression part of MATH_EXPRESSION_SUBPART or HYBRID_SUBPART: same contract as
 * MathExpressionQuestion, `language` included. Box ids restart at 1 in every part.
 */
export interface MathExpressionPart
  extends MathExpressionFields,
    QuestionIdentity {}

/** One text answer of a PATTERN_MATCH question (Python `PatternMatchPlaceholder`, no other keys). */
export interface PatternMatchPlaceholder {
  /** The box's number: a JSON integer equal to its 1-based position in `placeholders`. */
  placeholder_id: number;
  /**
   * The answer pattern: a Python `re` regular expression the whole answer must match (full
   * match). Not blank, at most 1000 characters, compiles, and is not wrapped in LaTeX delimiters.
   * Python syntax: a JavaScript `RegExp` may read it differently, so don't grade with it in the
   * browser without care.
   */
  value: string;
  /** Accepted answers that fully match `value`, used as self-tests: at least 1, none blank. */
  valid_examples: string[];
}

/**
 * PATTERN_MATCH fields (Python `PATTERN_MATCH`), "typed text": the learner types short text in a
 * precise format (a symbol, a code, a time, a ratio) into each box; it is right when it fully
 * matches the box's pattern. No settings: no `answers_interchangeable`, tolerance or matching.
 */
export interface PatternMatchFields extends AnswerBoxFields {
  question_type: "PATTERN_MATCH";
  /** One per box, ids 1..N in list order (at least 1). */
  placeholders: PatternMatchPlaceholder[];
}

/** A typed-text (answer pattern) question in a set. */
export interface PatternMatchQuestion
  extends PatternMatchFields,
    QuestionIdentity {}

/**
 * A typed-text part of PATTERN_MATCH_SUBPART or HYBRID_SUBPART: same contract as
 * PatternMatchQuestion, `language` included. Box ids restart at 1 in every part.
 */
export interface PatternMatchPart
  extends PatternMatchFields,
    QuestionIdentity {}

// ------------------------------------------------------------------------------- multi-part parents

/**
 * Fields of the classic multi-part parents (Python `BaseSubpartQuestion`): OPEN_ENDED_, MCQ_,
 * FIB_, DROP_DOWN_, TRUE_FALSE_ and HYBRID_SUBPART. The parent holds an optional shared context;
 * every part has its own solution and hint.
 */
export interface MultipartQuestionBase extends QuestionEnvelope {
  /**
   * The shared context (a scenario, a data set, a picture). Optional; not blank when present,
   * and with no `{placeholderN}` tokens (blanks belong in the parts).
   */
  question?: RichContent | null;
  /**
   * Leave out: the platform rejects any non-blank value here (each part has its own solution).
   * Tolerated only when blank.
   */
  solution?: RichContent | null;
  /**
   * Leave out: the platform rejects any non-blank value here (each part has its own hint).
   * Tolerated only when blank.
   */
  hint?: RichContent | null;
}

/** A written-answer question in parts: every part is OPEN_ENDED. */
export interface OpenEndedSubpart extends MultipartQuestionBase {
  question_type: "OPEN_ENDED_SUBPART";
  /** The parts, in order: at least 1 (2–4 is the guidance), all OPEN_ENDED. */
  subparts: OpenEndedPart[];
}

/** A multiple-choice question in parts: every part is MCQ. */
export interface McqSubpart extends MultipartQuestionBase {
  question_type: "MCQ_SUBPART";
  /** The parts, in order: at least 1 (2–4 is the guidance), all MCQ. */
  subparts: McqPart[];
}

/** A fill-in-the-blanks question in parts: every part is FIB, with its own blanks and word bank. */
export interface FibSubpart extends MultipartQuestionBase {
  question_type: "FIB_SUBPART";
  /** The parts, in order: at least 1 (2–4 is the guidance), all FIB. */
  subparts: FibPart[];
}

/** A dropdown-blanks question in parts: every part is DROP_DOWN. */
export interface DropDownSubpart extends MultipartQuestionBase {
  question_type: "DROP_DOWN_SUBPART";
  /** The parts, in order: at least 1 (2–4 is the guidance), all DROP_DOWN. */
  subparts: DropDownPart[];
}

/** True-or-false statements in parts: every part is TRUE_FALSE. */
export interface TrueFalseSubpart extends MultipartQuestionBase {
  question_type: "TRUE_FALSE_SUBPART";
  /** The parts, in order: at least 1 (2–4 is the guidance), all TRUE_FALSE. */
  subparts: TrueFalsePart[];
}

/**
 * A question in parts of mixed types (Python `HybridSubpart`): at least two different base types
 * among the parts (no nested multi-part types). Every part needs its own hint, MTC included, and
 * the non-zero DECIMAL tolerances of its parts must be identical.
 */
export interface HybridSubpart extends MultipartQuestionBase {
  question_type: "HYBRID_SUBPART";
  /** The parts, in order: at least 1 (2–4 is the guidance), of at least two different base types. */
  subparts: QuestionPart[];
}

/**
 * Fields of the typed multi-part parents (Python `_StrictTypedAnswerBoxSubpart`):
 * DECIMAL_, MATH_EXPRESSION_ and PATTERN_MATCH_SUBPART. The model forbids unknown fields, so the
 * parent has no `solution` or `hint` at all.
 */
export interface AnswerBoxMultipartBase extends QuestionIdentity {
  /**
   * The shared context. Required, not blank, with no `{placeholderN}` tokens and no `____`
   * blanks.
   */
  question: RichContent;
  /** The set's difficulty. Optional for these types; the parser writes it. */
  difficulty_level?: DifficultyLevel;
  /** The question's language (see SUPPORTED_LANGUAGES). Required, not blank. */
  language: string;
}

/** Typed-number answers in parts: every part is DECIMAL. */
export interface DecimalSubpart extends AnswerBoxMultipartBase {
  question_type: "DECIMAL_SUBPART";
  /**
   * The parts, in order: at least 1 (2–4 is the guidance), all DECIMAL. Their non-zero
   * tolerance pairs must be identical.
   */
  subparts: DecimalPart[];
}

/** Typed-expression answers in parts: every part is MATH_EXPRESSION, each with its own `matching`. */
export interface MathExpressionSubpart extends AnswerBoxMultipartBase {
  question_type: "MATH_EXPRESSION_SUBPART";
  /** The parts, in order: at least 1 (2–4 is the guidance), all MATH_EXPRESSION. */
  subparts: MathExpressionPart[];
}

/** Typed-text (answer pattern) answers in parts: every part is PATTERN_MATCH. */
export interface PatternMatchSubpart extends AnswerBoxMultipartBase {
  question_type: "PATTERN_MATCH_SUBPART";
  /** The parts, in order: at least 1 (2–4 is the guidance), all PATTERN_MATCH. */
  subparts: PatternMatchPart[];
}

// ------------------------------------------------------------------------------- unions and maps

/**
 * Each `question_type` and the interface of a question of that type in a set. Use it to type a
 * per-type table, e.g. `{ [K in QuestionTypeId]: (q: QuestionByType[K]) => ReactNode }`.
 */
export interface QuestionByType {
  MCQ: McqQuestion;
  OPEN_ENDED: OpenEndedQuestion;
  TRUE_FALSE: TrueFalseQuestion;
  FIB: FibQuestion;
  DROP_DOWN: DropDownQuestion;
  MTC: MtcQuestion;
  DECIMAL: DecimalQuestion;
  MATH_EXPRESSION: MathExpressionQuestion;
  PATTERN_MATCH: PatternMatchQuestion;
  OPEN_ENDED_SUBPART: OpenEndedSubpart;
  MCQ_SUBPART: McqSubpart;
  FIB_SUBPART: FibSubpart;
  DROP_DOWN_SUBPART: DropDownSubpart;
  TRUE_FALSE_SUBPART: TrueFalseSubpart;
  DECIMAL_SUBPART: DecimalSubpart;
  MATH_EXPRESSION_SUBPART: MathExpressionSubpart;
  PATTERN_MATCH_SUBPART: PatternMatchSubpart;
  HYBRID_SUBPART: HybridSubpart;
}

/** Each base type and the interface of a part of that type (an item of `subparts`). */
export interface PartByType {
  MCQ: McqPart;
  OPEN_ENDED: OpenEndedPart;
  TRUE_FALSE: TrueFalsePart;
  FIB: FibPart;
  DROP_DOWN: DropDownPart;
  MTC: MtcPart;
  DECIMAL: DecimalPart;
  MATH_EXPRESSION: MathExpressionPart;
  PATTERN_MATCH: PatternMatchPart;
}

/** Any question in a set's `variations`; switch on `question_type` to narrow it. */
export type TopicQuestion = QuestionByType[QuestionTypeId];

/** A question in a set of one of the 9 single types. */
export type TopicBaseQuestion = QuestionByType[BaseQuestionTypeId];

/** A multi-part question (a parent with `subparts`) of one of the 9 multi-part types. */
export type TopicSubpart = QuestionByType[SubpartTypeId];

/** A part of a multi-part question (an item of `subparts`). */
export type QuestionPart = PartByType[BaseQuestionTypeId];

/** The parts a multi-part question of type `K` holds. */
export type PartsOf<K extends SubpartTypeId> =
  QuestionByType[K]["subparts"][number];

// ------------------------------------------------------------------------------- topic and question sets

/**
 * A question set (Python and JSON: a "CT", configuration type). One type and one difficulty per
 * set (v1); its questions are variants of the same skill. Unknown keys (from the `.md`'s
 * `- Extra JSON:` line) are kept.
 */
export interface TopicCt {
  /**
   * The set's identity: unique in the topic, non-empty, no spaces, usually
   * `<descriptive_name>_ct_<number>` (e.g. `photosynthesis_ct_003`).
   */
  key: string;
  /** The set's difficulty; every question of the set repeats it. Required by the validator. */
  difficulty_level: DifficultyLevel;
  /** The questions (variants), in file order. At least 1. */
  variations: TopicQuestion[];
  /** Extra keys are preserved as they are. */
  [extra: string]: unknown;
}

/**
 * A topic file: what `topic_parser.py to-json` writes and the Ingester uploads. Unknown keys
 * (from the `.md`'s `- Extra JSON:` line) are kept.
 */
export interface Topic {
  /** The topic's identity (a UUID for new topics): non-empty. Uploads of the same topic share it. */
  topic_id: string;
  /**
   * The topic's name (`# Topic: <name>`). Optional: topics made by the platform's generator may
   * lack it (the validator only warns).
   */
  topic_name?: string;
  /** The question sets, in file order. */
  cts: TopicCt[];
  /** Extra keys are preserved as they are. */
  [extra: string]: unknown;
}

// ------------------------------------------------------------------------------- registry

/**
 * The kind of interaction, for grouping per-type UX:
 * - `choice`: pick from given answers (MCQ, TRUE_FALSE);
 * - `blanks`: fill blanks in the question text from given keywords (FIB, DROP_DOWN);
 * - `matching`: pair two columns (MTC);
 * - `answer_box`: type answers into boxes (DECIMAL, MATH_EXPRESSION, PATTERN_MATCH);
 * - `text`: write a free answer (OPEN_ENDED);
 * - `multipart`: a shared context with parts (every *_SUBPART type).
 */
export type QuestionFamily =
  | "choice"
  | "blanks"
  | "matching"
  | "answer_box"
  | "text"
  | "multipart";

/** What the UI knows about a question type. */
export interface QuestionTypeInfo<K extends QuestionTypeId = QuestionTypeId> {
  /** The `question_type` value. */
  readonly id: K;
  /** The type in plain creator words (the skill's own names where it has them). */
  readonly label: string;
  /** One plain sentence: what the learner does and how it is checked. */
  readonly description: string;
  readonly family: QuestionFamily;
  /** Whether this is a multi-part type (a parent with `subparts`). */
  readonly subpart: boolean;
  /** Multi-part types: the type every part has, or `"mixed"` for HYBRID_SUBPART. */
  readonly partType?: BaseQuestionTypeId | "mixed";
  /** The name of a lucide-react icon (e.g. "ListChecks"), for the UI to import. */
  readonly icon?: string;
}

/**
 * Every question type (single and multi-part), keyed by `question_type`. Entries are in
 * QUESTION_TYPE_IDS order; iterate QUESTION_TYPE_IDS for a stable order.
 */
export const QUESTION_TYPES: {
  readonly [K in QuestionTypeId]: QuestionTypeInfo<K>;
} = {
  MCQ: {
    id: "MCQ",
    label: "Multiple choice",
    description:
      "The learner picks one or more answers from a list of options.",
    family: "choice",
    subpart: false,
    icon: "ListChecks",
  },
  OPEN_ENDED: {
    id: "OPEN_ENDED",
    label: "Written answer",
    description:
      "The learner writes an explanation, proof or worked answer; the solution is the model answer.",
    family: "text",
    subpart: false,
    icon: "PenLine",
  },
  TRUE_FALSE: {
    id: "TRUE_FALSE",
    label: "True or false",
    description: "The learner decides whether one statement is true or false.",
    family: "choice",
    subpart: false,
    icon: "ToggleRight",
  },
  FIB: {
    id: "FIB",
    label: "Fill in the blanks",
    description:
      "The learner drags keywords into the blanks of a sentence (drag and drop).",
    family: "blanks",
    subpart: false,
    icon: "TextCursorInput",
  },
  DROP_DOWN: {
    id: "DROP_DOWN",
    label: "Dropdown blanks",
    description:
      "The learner picks each blank's answer from its own dropdown menu.",
    family: "blanks",
    subpart: false,
    icon: "SquareChevronDown",
  },
  MTC: {
    id: "MTC",
    label: "Match the columns",
    description:
      "The learner pairs each item on the left with one item on the right.",
    family: "matching",
    subpart: false,
    icon: "ArrowLeftRight",
  },
  DECIMAL: {
    id: "DECIMAL",
    label: "Typed number",
    description:
      "The learner types a number, checked exactly or within a tolerance.",
    family: "answer_box",
    subpart: false,
    icon: "Hash",
  },
  MATH_EXPRESSION: {
    id: "MATH_EXPRESSION",
    label: "Typed expression",
    description:
      "The learner types a maths expression, checked by its exact form or by equivalence.",
    family: "answer_box",
    subpart: false,
    icon: "Sigma",
  },
  PATTERN_MATCH: {
    id: "PATTERN_MATCH",
    label: "Typed text",
    description:
      "The learner types short text in a precise format, checked against an answer pattern.",
    family: "answer_box",
    subpart: false,
    icon: "Regex",
  },
  OPEN_ENDED_SUBPART: {
    id: "OPEN_ENDED_SUBPART",
    label: "Written answers in parts",
    description: "One shared context with written-answer parts.",
    family: "multipart",
    subpart: true,
    partType: "OPEN_ENDED",
    icon: "Layers",
  },
  MCQ_SUBPART: {
    id: "MCQ_SUBPART",
    label: "Multiple choice in parts",
    description: "One shared context with multiple-choice parts.",
    family: "multipart",
    subpart: true,
    partType: "MCQ",
    icon: "Layers",
  },
  FIB_SUBPART: {
    id: "FIB_SUBPART",
    label: "Fill in the blanks in parts",
    description: "One shared context with fill-in-the-blanks parts.",
    family: "multipart",
    subpart: true,
    partType: "FIB",
    icon: "Layers",
  },
  DROP_DOWN_SUBPART: {
    id: "DROP_DOWN_SUBPART",
    label: "Dropdown blanks in parts",
    description: "One shared context with dropdown-blank parts.",
    family: "multipart",
    subpart: true,
    partType: "DROP_DOWN",
    icon: "Layers",
  },
  TRUE_FALSE_SUBPART: {
    id: "TRUE_FALSE_SUBPART",
    label: "True or false in parts",
    description: "One shared context with true-or-false statements.",
    family: "multipart",
    subpart: true,
    partType: "TRUE_FALSE",
    icon: "Layers",
  },
  DECIMAL_SUBPART: {
    id: "DECIMAL_SUBPART",
    label: "Typed numbers in parts",
    description: "One shared context with typed-number parts.",
    family: "multipart",
    subpart: true,
    partType: "DECIMAL",
    icon: "Layers",
  },
  MATH_EXPRESSION_SUBPART: {
    id: "MATH_EXPRESSION_SUBPART",
    label: "Typed expressions in parts",
    description: "One shared context with typed-expression parts.",
    family: "multipart",
    subpart: true,
    partType: "MATH_EXPRESSION",
    icon: "Layers",
  },
  PATTERN_MATCH_SUBPART: {
    id: "PATTERN_MATCH_SUBPART",
    label: "Typed text in parts",
    description: "One shared context with typed-text parts.",
    family: "multipart",
    subpart: true,
    partType: "PATTERN_MATCH",
    icon: "Layers",
  },
  HYBRID_SUBPART: {
    id: "HYBRID_SUBPART",
    label: "Mixed types in parts",
    description:
      "One shared context with parts of at least two different question types.",
    family: "multipart",
    subpart: true,
    partType: "mixed",
    icon: "Shapes",
  },
};

// ------------------------------------------------------------------------------- guards

const QUESTION_TYPE_SET: ReadonlySet<string> = new Set<string>(
  QUESTION_TYPE_IDS,
);
const SUBPART_TYPE_SET: ReadonlySet<string> = new Set<string>(SUBPART_TYPE_IDS);
const BASE_TYPE_SET: ReadonlySet<string> = new Set<string>(
  BASE_QUESTION_TYPE_IDS,
);

/** Whether `value` is a known `question_type` (any of the 18, single or multi-part). */
export function isQuestionType(value: unknown): value is QuestionTypeId {
  return typeof value === "string" && QUESTION_TYPE_SET.has(value);
}

/** Whether `value` is a multi-part type (`*_SUBPART`). */
export function isSubpartType(value: unknown): value is SubpartTypeId {
  return typeof value === "string" && SUBPART_TYPE_SET.has(value);
}

/** Whether `value` is one of the 9 single types (the types a part can have). */
export function isBaseQuestionType(
  value: unknown,
): value is BaseQuestionTypeId {
  return typeof value === "string" && BASE_TYPE_SET.has(value);
}

/** The registry entry for `value`, or undefined when it isn't a known type. */
export function questionTypeInfo(value: unknown): QuestionTypeInfo | undefined {
  return isQuestionType(value) ? QUESTION_TYPES[value] : undefined;
}

/** Narrows a question to the interface of type `id`: `isQuestionOfType(q, "MCQ")` -> McqQuestion. */
export function isQuestionOfType<K extends QuestionTypeId>(
  question: TopicQuestion,
  id: K,
): question is QuestionByType[K] {
  return question.question_type === id;
}

/** Narrows a part to the interface of type `id`: `isPartOfType(p, "DECIMAL")` -> DecimalPart. */
export function isPartOfType<K extends BaseQuestionTypeId>(
  part: QuestionPart,
  id: K,
): part is PartByType[K] {
  return part.question_type === id;
}

/** Whether a question is a multi-part parent (has `subparts`). */
export function isMultipartQuestion(
  question: TopicQuestion,
): question is TopicSubpart {
  return isSubpartType(question.question_type);
}

// ------------------------------------------------------------------------------- lenient reading

/** A question with a known type, found in a topic that has not been checked. */
export interface TopicQuestionEntry {
  /** 0-based index of the question set in `cts` ("Set 1" is index 0). */
  setIndex: number;
  /**
   * The set's key (`TopicCt.key`); the question's own `ct_key` when the set has none; otherwise
   * undefined. Questions often carry no `ct_key`, so the set's key comes first.
   */
  ctKey?: string;
  /** 0-based index of the question in the set's `variations`. */
  questionIndex: number;
  /** The question's `question_no` when it is an integer >= 1 (legacy sets have none). */
  questionNo?: number;
  /**
   * The question. Only `question_type` has been checked: the other fields are as the file has
   * them, so render them defensively.
   */
  question: TopicQuestion;
}

/** Why a question in `variations` could not be recognised. */
export type UnreadableQuestionReason =
  | "not_an_object"
  | "missing_type"
  | "unknown_type";

/** A question that could not be recognised (reported, never thrown). */
export interface UnreadableQuestion {
  setIndex: number;
  ctKey?: string;
  questionIndex: number;
  /** The `question_type` as written, when it is a string. */
  questionType?: string;
  reason: UnreadableQuestionReason;
}

/** What `readTopicQuestions` found. */
export interface TopicQuestionsReading {
  /** Questions with a known type, in file order. */
  questions: TopicQuestionEntry[];
  /** Questions that aren't objects or whose `question_type` is missing or unknown. */
  unknown: UnreadableQuestion[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function positiveInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= 1
    ? value
    : undefined;
}

/**
 * Lists the questions of any value that may be a topic (parsed JSON from an upload). Never
 * throws: a value that isn't an object, a missing or non-list `cts`, and sets that aren't objects
 * or have no `variations` list give no questions; a question that isn't an object or has a
 * missing or unknown `question_type` is reported in `unknown`. Doesn't need `topic_name`,
 * `topic_id` or `ct_key`.
 */
export function readTopicQuestions(topic: unknown): TopicQuestionsReading {
  const reading: TopicQuestionsReading = { questions: [], unknown: [] };
  if (!isRecord(topic) || !Array.isArray(topic.cts)) return reading;

  topic.cts.forEach((ct: unknown, setIndex: number) => {
    if (!isRecord(ct) || !Array.isArray(ct.variations)) return;
    const setKey = nonEmptyString(ct.key);
    ct.variations.forEach((raw: unknown, questionIndex: number) => {
      if (!isRecord(raw)) {
        reading.unknown.push({
          setIndex,
          ctKey: setKey,
          questionIndex,
          reason: "not_an_object",
        });
        return;
      }
      const ctKey = setKey ?? nonEmptyString(raw.ct_key);
      const type = raw.question_type;
      if (isQuestionType(type)) {
        reading.questions.push({
          setIndex,
          ctKey,
          questionIndex,
          questionNo: positiveInteger(raw.question_no),
          question: raw as unknown as TopicQuestion,
        });
        return;
      }
      reading.unknown.push({
        setIndex,
        ctKey,
        questionIndex,
        questionType: typeof type === "string" ? type : undefined,
        reason: typeof type === "string" ? "unknown_type" : "missing_type",
      });
    });
  });
  return reading;
}

/** How many sets and questions of one type a topic has. */
export interface QuestionTypeCount {
  type: QuestionTypeId;
  /** QUESTION_TYPES[type].label. */
  label: string;
  /** Question sets with at least one question of this type. */
  sets: number;
  /** Questions of this type (a multi-part question counts once, not per part). */
  questions: number;
}

/**
 * The question types a topic uses, in QUESTION_TYPE_IDS order, with how many sets and questions
 * have each. Counts only questions with a known type (see `readTopicQuestions` for the rest);
 * types the topic doesn't use are left out. Never throws.
 */
export function questionTypeCounts(topic: unknown): QuestionTypeCount[] {
  const sets = new Map<QuestionTypeId, Set<number>>();
  const questions = new Map<QuestionTypeId, number>();
  for (const { setIndex, question } of readTopicQuestions(topic).questions) {
    const type = question.question_type;
    questions.set(type, (questions.get(type) ?? 0) + 1);
    const seen = sets.get(type) ?? new Set<number>();
    seen.add(setIndex);
    sets.set(type, seen);
  }
  return QUESTION_TYPE_IDS.filter((type) => questions.has(type)).map(
    (type) => ({
      type,
      label: QUESTION_TYPES[type].label,
      sets: sets.get(type)?.size ?? 0,
      questions: questions.get(type) ?? 0,
    }),
  );
}
