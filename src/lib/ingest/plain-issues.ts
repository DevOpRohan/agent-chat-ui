/**
 * Turns the checker's findings into a short, plain list for creators:
 * "Set 2, variant 3: The hint needs to end as a statement, with a full stop."
 *
 * Wording follows the TopicCrafter skill's own table
 * (skills/topic-crafter/references/communication.md, "Turning check results into plain words"),
 * in the present tense because these are still open. Sets are numbered by their position in
 * the topic (1-based), the same "CT <n>" numbering as the creator's .md headings; variants use
 * `question_no`. CT keys never lead a label; they only follow it, small, for cross-reference.
 *
 * Ported from topic-ingester (src/lib/plain-issues.ts); the sentences are kept word for word.
 */

export interface RawFinding {
  severity?: string;
  code?: string;
  ctKey?: string;
  questionNo?: number;
  field?: string;
  message?: string;
}

export interface PlainIssue {
  text: string;
  /** Where in the question, in plain words ("Hint", "Part 2, solution"). */
  where?: string;
  optional: boolean;
}

export interface IssueGroup {
  key: string;
  /** "Whole topic", "Set 3", "Set 3, variant 2", or "A question set" when the set isn't in the topic. */
  label: string;
  setNumber?: number;
  variant?: number;
  ctKey?: string;
  issues: PlainIssue[];
}

export const GENERIC_ISSUE =
  "Something here needs a small change. Your assistant will find the details in the report.";

const LATEX_RE = /latex|unbalanced|nested|delimiter|\\\(|\\\[/i;

/** One plain sentence for a finding (the skill's wording, present tense). */
export function plainSentence(finding: RawFinding): string {
  const code = (finding.code ?? "").toUpperCase().trim();
  const message = finding.message ?? "";
  const field = (finding.field ?? "").toLowerCase();

  if (code === "PARSER LATEX" || LATEX_RE.test(message)) {
    return "A maths expression isn't written in a way the platform can display.";
  }
  switch (code) {
    case "HINT REQUIRED":
      return "A hint is missing.";
    case "PUNCTUATION":
      return field.includes("hint") || /hint/i.test(message)
        ? "The hint needs to end as a statement, with a full stop."
        : "The punctuation here needs a small fix.";
    case "ANSWER BOX PLACEHOLDER VISIBILITY":
      return "An answer box is inside the question text instead of below it.";
    case "SUBPART PLACEHOLDER VISIBILITY":
      return "A blank is in the shared intro instead of in a part.";
    case "IDENTITY":
      return /duplicate ct key/i.test(message)
        ? "Two question sets have the same label."
        : "Two questions share the same label.";
    case "TOPIC":
      return "The topic's header details need a fix.";
    case "CT":
      return "The set's header details need a fix.";
    case "SYSTEM FIELDS":
      return "The question's header details need a fix.";
    case "STYLE":
      return "Some bold or italic styling the platform doesn't show.";
    case "PLATFORM":
      return "A matching pair needs a short explanation.";
    case "LANGUAGE":
      return "The language doesn't match the rest of the topic.";
    case "PYDANTIC":
      return "A part of the question is missing or in the wrong form.";
    default:
      if (/field required|cannot be empty|missing/i.test(message)) {
        return "A part of the question is missing or in the wrong form.";
      }
      return GENERIC_ISSUE;
  }
}

const FIELD_NAMES: Record<string, string> = {
  hint: "Hint",
  hints: "Hint",
  solution: "Solution",
  question: "Question text",
  options: "Answer options",
  correct_options: "Correct answers",
  answer: "Answer",
  answers: "Answer",
  language: "Language",
  difficulty_level: "Difficulty",
  question_type: "Question type",
  placeholders: "Answer box",
  subparts: "Part",
};

/** "subparts[1].solution" -> "Part 2, solution"; "placeholders[0].value" -> "Answer box 1". */
export function plainField(field?: string): string | undefined {
  if (!field) return undefined;
  const parts = field.split(".").filter(Boolean);
  const words: string[] = [];
  for (const part of parts) {
    const match = part.match(/^([A-Za-z_]+)(?:\[(\d+)\])?$/);
    if (!match) return undefined;
    const [, name, index] = match;
    if (name === "value" && words.length) continue;
    const base = FIELD_NAMES[name!] ?? name!.replace(/_/g, " ");
    words.push(index !== undefined ? `${base} ${Number(index) + 1}` : base);
  }
  if (!words.length) return undefined;
  const text = words.join(", ");
  return text[0]!.toUpperCase() + text.slice(1).toLowerCase();
}

export function groupLabel(
  setNumber?: number,
  variant?: number,
  hasSet = true,
): string {
  if (!hasSet) return "Whole topic";
  const set = setNumber ? `Set ${setNumber}` : "A question set";
  return variant !== undefined ? `${set}, variant ${variant}` : set;
}

/** ct_key -> 1-based position in the topic. */
export function ctIndexOf(topic: unknown): Record<string, number> {
  const index: Record<string, number> = {};
  if (!topic || typeof topic !== "object") return index;
  const cts = (topic as { cts?: unknown }).cts;
  if (!Array.isArray(cts)) return index;
  cts.forEach((ct, i) => {
    const key =
      ct && typeof ct === "object" ? (ct as { key?: unknown }).key : undefined;
    if (typeof key === "string" && !(key in index)) index[key] = i + 1;
  });
  return index;
}

/** Plain issues grouped by set and variant: whole-topic items first, then by set, then variant. */
export function groupIssues(
  findings: readonly RawFinding[],
  ctIndex: Record<string, number>,
): IssueGroup[] {
  const groups = new Map<string, IssueGroup>();
  for (const finding of findings) {
    if (!(finding.message || finding.code)) continue;
    const ctKey = finding.ctKey;
    const setNumber = ctKey ? ctIndex[ctKey] : undefined;
    const variant = ctKey ? finding.questionNo : undefined;
    const key = ctKey ? `${ctKey}#${variant ?? ""}` : "topic";
    let group = groups.get(key);
    if (!group) {
      group = {
        key,
        label: groupLabel(setNumber, variant, !!ctKey),
        setNumber,
        variant,
        ctKey,
        issues: [],
      };
      groups.set(key, group);
    }
    const issue: PlainIssue = {
      text: plainSentence(finding),
      where: plainField(finding.field),
      optional: (finding.severity ?? "error") !== "error",
    };
    if (
      !group.issues.some(
        (i) => i.text === issue.text && i.where === issue.where,
      )
    )
      group.issues.push(issue);
  }
  const rank = (g: IssueGroup) => [
    g.ctKey ? 1 : 0,
    g.setNumber ?? Number.MAX_SAFE_INTEGER,
    g.variant ?? -1,
  ];
  return [...groups.values()].sort((a, b) => {
    const [x, y] = [rank(a), rank(b)];
    for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return x[i]! - y[i]!;
    return a.key.localeCompare(b.key);
  });
}

/** Marker the Markdown renderer turns into a small, muted CT key after a set label. */
export const SET_KEY_MARKER = "set-key:";

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Replaces known CT keys in Markdown (the fixer's report) with "Set N" or "Set N, variant M",
 * followed by the key as a small muted reference. Text inside code blocks is left alone.
 */
export function labelSetsInMarkdown(
  markdown: string,
  ctIndex: Record<string, number>,
): string {
  const keys = Object.keys(ctIndex).sort((a, b) => b.length - a.length);
  if (!keys.length) return markdown;
  const pattern = new RegExp(
    "`?\\b(" +
      keys.map(escapeRegExp).join("|") +
      ")\\b`?(?:\\s*(?:/|#|,\\s*(?:variant|question(?:_no)?)\\s*|\\s+variant\\s+)\\s*(\\d+))?",
    "g",
  );
  return markdown
    .split(/(```[\s\S]*?```)/g)
    .map((chunk) =>
      chunk.startsWith("```")
        ? chunk
        : chunk.replace(pattern, (_m, key: string, variant?: string) => {
            const label = groupLabel(
              ctIndex[key],
              variant ? Number(variant) : undefined,
            );
            return `${label} \`${SET_KEY_MARKER}${key}\``;
          }),
    )
    .join("");
}
