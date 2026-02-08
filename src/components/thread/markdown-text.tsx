"use client";

import "./markdown-styles.css";

import ReactMarkdown, { MarkdownHooks } from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeKatex from "rehype-katex";
import rehypePrettyCode, {
  type Options as RehypePrettyCodeOptions,
} from "rehype-pretty-code";
import remarkMath from "remark-math";
import {
  Component,
  FC,
  memo,
  useMemo,
  useState,
  isValidElement,
  type ErrorInfo,
  type HTMLAttributes,
  type ReactNode,
} from "react";
import { CheckIcon, CopyIcon } from "lucide-react";

import { TooltipIconButton } from "@/components/thread/tooltip-icon-button";
import { cn } from "@/lib/utils";

import "katex/dist/katex.min.css";

const useCopyToClipboard = ({
  copiedDuration = 3000,
}: {
  copiedDuration?: number;
} = {}) => {
  const [isCopied, setIsCopied] = useState<boolean>(false);

  const copyToClipboard = (value: string) => {
    if (!value) return;

    navigator.clipboard.writeText(value).then(() => {
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), copiedDuration);
    });
  };

  return { isCopied, copyToClipboard };
};

function extractTextFromNode(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") {
    return String(node);
  }

  if (!node) {
    return "";
  }

  if (Array.isArray(node)) {
    return node.map((item) => extractTextFromNode(item)).join("");
  }

  if (isValidElement(node)) {
    const props = node.props as { children?: ReactNode };
    return extractTextFromNode(props.children);
  }

  return "";
}

function collectCodeLines(node: ReactNode, lines: string[]): void {
  if (!node) return;

  if (Array.isArray(node)) {
    for (const item of node) {
      collectCodeLines(item, lines);
    }
    return;
  }

  if (isValidElement(node)) {
    const props = node.props as {
      children?: ReactNode;
      "data-line"?: unknown;
    };
    if ("data-line" in props) {
      lines.push(extractTextFromNode(props.children));
      return;
    }

    collectCodeLines(props.children, lines);
  }
}

function extractCodeText(node: ReactNode): string {
  const lines: string[] = [];
  collectCodeLines(node, lines);

  if (lines.length > 0) {
    return lines.join("\n");
  }

  return extractTextFromNode(node);
}

type CodeBlockPreProps = HTMLAttributes<HTMLPreElement> & {
  children?: ReactNode;
};

const CodeBlockPre: FC<CodeBlockPreProps> = ({
  className,
  children,
  ...props
}) => {
  const { isCopied, copyToClipboard } = useCopyToClipboard();
  const code = useMemo(
    () => extractCodeText(children).replace(/\n$/, ""),
    [children],
  );

  const onCopy = () => {
    if (!code || isCopied) return;
    copyToClipboard(code);
  };

  return (
    <div className="group relative my-4 max-w-4xl">
      <pre
        className={cn("max-w-4xl overflow-x-auto rounded-lg", className)}
        {...props}
      >
        {children}
      </pre>
      {code ? (
        <TooltipIconButton
          tooltip="Copy code"
          onClick={onCopy}
          className="bg-background/85 text-muted-foreground border-border hover:text-foreground absolute top-2 right-2 z-10 border opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100"
        >
          {!isCopied ? (
            <CopyIcon className="h-3.5 w-3.5" />
          ) : (
            <CheckIcon className="h-3.5 w-3.5" />
          )}
        </TooltipIconButton>
      ) : null}
    </div>
  );
};

const defaultComponents: any = {
  h1: ({ className, ...props }: { className?: string }) => (
    <h1
      className={cn(
        "mb-8 scroll-m-20 text-4xl font-extrabold tracking-tight last:mb-0",
        className,
      )}
      {...props}
    />
  ),
  h2: ({ className, ...props }: { className?: string }) => (
    <h2
      className={cn(
        "mt-8 mb-4 scroll-m-20 text-3xl font-semibold tracking-tight first:mt-0 last:mb-0",
        className,
      )}
      {...props}
    />
  ),
  h3: ({ className, ...props }: { className?: string }) => (
    <h3
      className={cn(
        "mt-6 mb-4 scroll-m-20 text-2xl font-semibold tracking-tight first:mt-0 last:mb-0",
        className,
      )}
      {...props}
    />
  ),
  h4: ({ className, ...props }: { className?: string }) => (
    <h4
      className={cn(
        "mt-6 mb-4 scroll-m-20 text-xl font-semibold tracking-tight first:mt-0 last:mb-0",
        className,
      )}
      {...props}
    />
  ),
  h5: ({ className, ...props }: { className?: string }) => (
    <h5
      className={cn(
        "my-4 text-lg font-semibold first:mt-0 last:mb-0",
        className,
      )}
      {...props}
    />
  ),
  h6: ({ className, ...props }: { className?: string }) => (
    <h6
      className={cn("my-4 font-semibold first:mt-0 last:mb-0", className)}
      {...props}
    />
  ),
  p: ({ className, ...props }: { className?: string }) => (
    <p
      className={cn("mt-5 mb-5 leading-7 first:mt-0 last:mb-0", className)}
      {...props}
    />
  ),
  a: ({ className, ...props }: { className?: string }) => (
    <a
      className={cn("font-medium", className)}
      {...props}
    />
  ),
  blockquote: ({ className, ...props }: { className?: string }) => (
    <blockquote
      className={cn("border-l-2 pl-6 italic", className)}
      {...props}
    />
  ),
  ul: ({ className, ...props }: { className?: string }) => (
    <ul
      className={cn("my-5 ml-6 list-disc [&>li]:mt-2", className)}
      {...props}
    />
  ),
  ol: ({ className, ...props }: { className?: string }) => (
    <ol
      className={cn("my-5 ml-6 list-decimal [&>li]:mt-2", className)}
      {...props}
    />
  ),
  hr: ({ className, ...props }: { className?: string }) => (
    <hr
      className={cn("my-5 border-b", className)}
      {...props}
    />
  ),
  table: ({ className, ...props }: { className?: string }) => (
    <table
      className={cn(
        "my-5 w-full border-separate border-spacing-0 overflow-y-auto",
        className,
      )}
      {...props}
    />
  ),
  th: ({ className, ...props }: { className?: string }) => (
    <th
      className={cn(
        "bg-muted px-4 py-2 text-left font-bold first:rounded-tl-lg last:rounded-tr-lg [&[align=center]]:text-center [&[align=right]]:text-right",
        className,
      )}
      {...props}
    />
  ),
  td: ({ className, ...props }: { className?: string }) => (
    <td
      className={cn(
        "border-b border-l px-4 py-2 text-left last:border-r [&[align=center]]:text-center [&[align=right]]:text-right",
        className,
      )}
      {...props}
    />
  ),
  tr: ({ className, ...props }: { className?: string }) => (
    <tr
      className={cn(
        "m-0 border-b p-0 first:border-t [&:last-child>td:first-child]:rounded-bl-lg [&:last-child>td:last-child]:rounded-br-lg",
        className,
      )}
      {...props}
    />
  ),
  sup: ({ className, ...props }: { className?: string }) => (
    <sup
      className={cn("[&>a]:text-xs [&>a]:no-underline", className)}
      {...props}
    />
  ),
  span: ({
    className,
    children,
    title,
    style,
    ...props
  }: HTMLAttributes<HTMLSpanElement>) => {
    const classTokens = (className ?? "").split(/\s+/).filter(Boolean);
    const isKatexErrorSpan = classTokens.includes("katex-error");

    if (!isKatexErrorSpan) {
      return (
        <span
          className={className}
          title={title}
          style={style}
          {...props}
        >
          {children}
        </span>
      );
    }

    const sanitizedClassName = classTokens
      .filter((token) => token !== "katex-error")
      .join(" ");

    return (
      <span
        className={cn("break-words whitespace-pre-wrap", sanitizedClassName)}
        {...props}
      >
        {children}
      </span>
    );
  },
  pre: ({ className, children, ...props }: CodeBlockPreProps) => (
    <CodeBlockPre
      className={className}
      {...props}
    >
      {children}
    </CodeBlockPre>
  ),
  code: ({
    className,
    children,
    ...props
  }: {
    className?: string;
    children: ReactNode;
    "data-language"?: string;
  }) => {
    const isBlockCode = typeof props["data-language"] === "string";

    return (
      <code
        className={cn(!isBlockCode && "rounded font-semibold", className)}
        {...props}
      >
        {children}
      </code>
    );
  },
};

const prettyCodeOptions: RehypePrettyCodeOptions = {
  theme: {
    light: "github-light",
    dark: "github-dark-default",
  },
  keepBackground: true,
  bypassInlineCode: true,
  defaultLang: {
    block: "plaintext",
    inline: "plaintext",
  },
};

const katexOptions = {
  throwOnError: false,
  strict: "ignore",
  errorColor: "currentColor",
} as const;

function getFenceRun(markdown: string, start: number): string | null {
  const marker = markdown[start];
  if (marker !== "`" && marker !== "~") return null;

  let end = start;
  while (end < markdown.length && markdown[end] === marker) {
    end += 1;
  }

  if (end - start < 3) return null;
  return markdown.slice(start, end);
}

function findClosingDelimiter(
  markdown: string,
  start: number,
  delimiter: "\\)" | "\\]",
): number {
  let cursor = start;

  while (cursor < markdown.length) {
    const matchIndex = markdown.indexOf(delimiter, cursor);
    if (matchIndex === -1) return -1;

    // Skip escaped delimiters (for example: `\\(` should stay literal text).
    if (!isEscapedDelimiter(markdown, matchIndex)) {
      return matchIndex;
    }

    cursor = matchIndex + delimiter.length;
  }

  return -1;
}

function isEscapedDelimiter(markdown: string, index: number): boolean {
  let backslashCount = 0;
  let cursor = index - 1;

  while (cursor >= 0 && markdown[cursor] === "\\") {
    backslashCount += 1;
    cursor -= 1;
  }

  return backslashCount % 2 === 1;
}

function normalizeLatexDelimiters(markdown: string): string {
  if (!markdown.includes("\\(") && !markdown.includes("\\[")) {
    return markdown;
  }

  let result = "";
  let index = 0;
  let activeFence: string | null = null;
  let inlineCodeTickCount: number | null = null;

  while (index < markdown.length) {
    const currentChar = markdown[index];
    const atLineStart = index === 0 || markdown[index - 1] === "\n";

    if (inlineCodeTickCount == null && atLineStart) {
      const fenceRun = getFenceRun(markdown, index);
      if (fenceRun) {
        if (!activeFence) {
          activeFence = fenceRun;
        } else if (
          fenceRun[0] === activeFence[0] &&
          fenceRun.length >= activeFence.length
        ) {
          activeFence = null;
        }

        result += fenceRun;
        index += fenceRun.length;
        continue;
      }
    }

    if (activeFence) {
      result += currentChar;
      index += 1;
      continue;
    }

    if (currentChar === "`") {
      let end = index;
      while (end < markdown.length && markdown[end] === "`") {
        end += 1;
      }

      const tickCount = end - index;
      result += markdown.slice(index, end);
      if (inlineCodeTickCount == null) {
        inlineCodeTickCount = tickCount;
      } else if (inlineCodeTickCount === tickCount) {
        inlineCodeTickCount = null;
      }

      index = end;
      continue;
    }

    if (inlineCodeTickCount != null) {
      result += currentChar;
      index += 1;
      continue;
    }

    const escapedOpenDelimiter = isEscapedDelimiter(markdown, index);

    if (!escapedOpenDelimiter && markdown.startsWith("\\[", index)) {
      const closingIndex = findClosingDelimiter(markdown, index + 2, "\\]");
      if (closingIndex !== -1) {
        const body = markdown.slice(index + 2, closingIndex);
        const trimmedBody = body.replace(/^\n+/, "").replace(/\n+$/, "");
        result += `$$\n${trimmedBody}\n$$`;
        index = closingIndex + 2;
        continue;
      }
    }

    if (!escapedOpenDelimiter && markdown.startsWith("\\(", index)) {
      const closingIndex = findClosingDelimiter(markdown, index + 2, "\\)");
      if (closingIndex !== -1) {
        const body = markdown.slice(index + 2, closingIndex);
        result += `$${body}$`;
        index = closingIndex + 2;
        continue;
      }
    }

    result += currentChar;
    index += 1;
  }

  return result;
}

function getRenderResetKey(markdown: string): string {
  if (!markdown) {
    return "0";
  }

  const previewWindow = 96;
  const head = markdown.slice(0, previewWindow);
  const tail = markdown.slice(-previewWindow);
  return `${markdown.length}:${head}:${tail}`;
}

type MarkdownRenderBoundaryProps = {
  children: ReactNode;
  fallback: ReactNode;
  resetKey: string;
};

type MarkdownRenderBoundaryState = {
  hasError: boolean;
};

class MarkdownRenderBoundary extends Component<
  MarkdownRenderBoundaryProps,
  MarkdownRenderBoundaryState
> {
  public state: MarkdownRenderBoundaryState = { hasError: false };

  static getDerivedStateFromError(): MarkdownRenderBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: unknown, _errorInfo: ErrorInfo): void {
    console.warn(
      "Markdown render failed. Falling back to safe markdown.",
      error,
    );
  }

  componentDidUpdate(prevProps: MarkdownRenderBoundaryProps): void {
    if (prevProps.resetKey !== this.props.resetKey && this.state.hasError) {
      this.setState({ hasError: false });
    }
  }

  render(): ReactNode {
    if (this.state.hasError) {
      return this.props.fallback;
    }

    return this.props.children;
  }
}

type MarkdownTextProps = {
  children: string;
  streaming?: boolean;
};

const MarkdownTextImpl: FC<MarkdownTextProps> = ({
  children,
  streaming = false,
}) => {
  const normalizedChildren = useMemo(
    () => (streaming ? children : normalizeLatexDelimiters(children)),
    [children, streaming],
  );
  const renderResetKey = useMemo(
    () => getRenderResetKey(normalizedChildren),
    [normalizedChildren],
  );

  const fallback = useMemo(
    () => (
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={defaultComponents}
      >
        {normalizedChildren}
      </ReactMarkdown>
    ),
    [normalizedChildren],
  );

  if (streaming) {
    return (
      <div className="markdown-content">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={defaultComponents}
        >
          {normalizedChildren}
        </ReactMarkdown>
      </div>
    );
  }

  return (
    <div className="markdown-content">
      <MarkdownRenderBoundary
        fallback={fallback}
        resetKey={renderResetKey}
      >
        <MarkdownHooks
          fallback={fallback}
          remarkPlugins={[remarkGfm, remarkMath]}
          rehypePlugins={[
            [rehypeKatex, katexOptions],
            [rehypePrettyCode, prettyCodeOptions],
          ]}
          components={defaultComponents}
        >
          {normalizedChildren}
        </MarkdownHooks>
      </MarkdownRenderBoundary>
    </div>
  );
};

export const MarkdownText = memo(MarkdownTextImpl);
