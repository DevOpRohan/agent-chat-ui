import { afterEach, describe, expect, it, vi } from "vitest";

import {
  downloadTextFile,
  isTopicFileUrl,
  reportFileName,
  TOPIC_FILE_HOSTS,
  topicFileHref,
  topicFileName,
} from "@/lib/ingest/file-links";
import { downloadBaseName } from "@/lib/ingest/topic-file";

const FILE =
  "https://storage.googleapis.com/qc-uploads/topic-import/photosynthesis_grade_8_fixed.json";

describe("isTopicFileUrl (the browser's half of /api/topic-file's allow-list)", () => {
  it("allows https .json/.md links on GCS and on S3 (the route's default hosts)", () => {
    expect(TOPIC_FILE_HOSTS).toEqual([
      "storage.googleapis.com",
      ".amazonaws.com",
    ]);
    expect(isTopicFileUrl(FILE)).toBe(true);
    expect(
      isTopicFileUrl(
        "https://transferredv2-cerebry-ai-topic-jsons.s3.ap-southeast-1.amazonaws.com/topic_import/t.md",
      ),
    ).toBe(true);
    expect(isTopicFileUrl("https://STORAGE.googleapis.com/b/t.md")).toBe(true);
    // The default port is the same host.
    expect(isTopicFileUrl("https://storage.googleapis.com:443/b/t.json")).toBe(
      true,
    );
  });

  it.each([
    ["plain http", "http://storage.googleapis.com/b/t.json"],
    ["another host", "https://evil.example/t.json"],
    ["a look-alike host", "https://storage.googleapis.com.evil.example/t.json"],
    ["a subdomain", "https://x.storage.googleapis.com/t.json"],
    ["a bare amazonaws.com", "https://amazonaws.com/b/t.json"],
    ["an S3 look-alike", "https://s3.amazonaws.com.evil.example/b/t.json"],
    ["another file type", "https://storage.googleapis.com/b/t.html"],
    ["no file name", "https://storage.googleapis.com/b/"],
    ["the host in the path", "https://evil.example/storage.googleapis.com/t"],
    ["a user name", "https://user@storage.googleapis.com/b/t.json"],
    ["a password", "https://user:pw@storage.googleapis.com/b/t.json"],
    ["another port", "https://storage.googleapis.com:8443/b/t.json"],
    ["a script", "javascript:alert(1)"],
    ["a data link", "data:application/json,{}"],
    ["a relative link", "/b/t.json"],
    ["text", "not a url"],
    ["an empty string", ""],
    ["spaces", "   "],
  ])("refuses %s", (_label, url) => {
    expect(isTopicFileUrl(url)).toBe(false);
  });

  it("refuses anything that isn't a string", () => {
    for (const value of [undefined, null, 1, {}, ["https://x"], new URL(FILE)])
      expect(isTopicFileUrl(value)).toBe(false);
  });
});

describe("topicFileHref", () => {
  it("links to the same-origin route with the link and file name encoded", () => {
    const href = topicFileHref(
      `${FILE}?x=1&y=2`,
      "photosynthesis grade 8 & co.json",
    );
    expect(href.startsWith("/api/topic-file?url=https%3A%2F%2F")).toBe(true);
    const params = new URL(href, "https://app.example").searchParams;
    expect(params.get("url")).toBe(`${FILE}?x=1&y=2`);
    expect(params.get("name")).toBe("photosynthesis grade 8 & co.json");
    expect([...params.keys()]).toEqual(["url", "name"]);
  });
});

describe("file names (as the standalone app named its downloads)", () => {
  it("names the report <downloadName>_report.md and the topic files <downloadName>.json/.md", () => {
    const base = downloadBaseName({
      fileName: "photosynthesis_grade_8.json",
      topicName: "Photosynthesis (Grade 8)",
    });
    expect(reportFileName(base)).toBe("photosynthesis_grade_8_report.md");
    expect(topicFileName(base, "json")).toBe("photosynthesis_grade_8.json");
    expect(topicFileName(base, "md")).toBe("photosynthesis_grade_8.md");
  });
});

describe("downloadTextFile", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("does nothing without a document (server rendering)", () => {
    const create = vi.spyOn(URL, "createObjectURL");
    expect(downloadTextFile("# Report", "t_report.md")).toBe(false);
    expect(create).not.toHaveBeenCalled();
  });

  it("saves the text through a temporary download link, then frees it", async () => {
    vi.useFakeTimers();
    const link = {
      href: "",
      download: "",
      rel: "",
      style: {} as Record<string, string>,
      click: vi.fn(),
      remove: vi.fn(),
    };
    const appendChild = vi.fn();
    vi.stubGlobal("window", {});
    vi.stubGlobal("document", {
      createElement: vi.fn(() => link),
      body: { appendChild },
    });
    const create = vi
      .spyOn(URL, "createObjectURL")
      .mockReturnValue("blob:report");
    const revoke = vi.spyOn(URL, "revokeObjectURL").mockReturnValue();

    expect(
      downloadTextFile("# Report\n", "photosynthesis_grade_8_report.md"),
    ).toBe(true);

    const blob = create.mock.calls[0]![0] as Blob;
    expect(blob.type).toBe("text/markdown;charset=utf-8");
    expect(await blob.text()).toBe("# Report\n");
    expect(link).toMatchObject({
      href: "blob:report",
      download: "photosynthesis_grade_8_report.md",
    });
    expect(appendChild).toHaveBeenCalledWith(link);
    expect(link.click).toHaveBeenCalledTimes(1);
    expect(link.remove).toHaveBeenCalledTimes(1);
    expect(revoke).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1000);
    expect(revoke).toHaveBeenCalledWith("blob:report");
  });

  it("takes another type when asked", () => {
    vi.useFakeTimers();
    vi.stubGlobal("window", {});
    vi.stubGlobal("document", {
      createElement: () => ({ style: {}, click() {}, remove() {} }),
      body: { appendChild() {} },
    });
    const create = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:x");
    vi.spyOn(URL, "revokeObjectURL").mockReturnValue();
    downloadTextFile("{}", "t.json", "application/json");
    expect((create.mock.calls[0]![0] as Blob).type).toBe("application/json");
  });
});
