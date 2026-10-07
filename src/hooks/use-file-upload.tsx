import {
  useState,
  useRef,
  useEffect,
  useCallback,
  ChangeEvent,
  SetStateAction,
} from "react";
import { toast } from "sonner";
import {
  ExtendedContentBlock,
  fileToContentBlock,
} from "@/lib/multimodal-utils";

export const SUPPORTED_FILE_TYPES = [
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "application/pdf",
];

export const MAX_IMAGE_ATTACHMENTS = 20;
export const MAX_PDF_ATTACHMENTS = 2;

interface UseFileUploadOptions {
  initialBlocks?: ExtendedContentBlock[];
}

export function useFileUpload({
  initialBlocks = [],
}: UseFileUploadOptions = {}) {
  const [contentBlocks, updateContentBlocks] =
    useState<ExtendedContentBlock[]>(initialBlocks);
  const blocksRef = useRef(contentBlocks);
  const pendingRef = useRef<File[]>([]);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const draftVersion = useRef(0);
  const isUploading = pendingFiles.length > 0;
  const dropRef = useRef<HTMLDivElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const dragCounter = useRef(0);

  const setContentBlocks = useCallback(
    (value: SetStateAction<ExtendedContentBlock[]>) => {
      const next =
        typeof value === "function" ? value(blocksRef.current) : value;
      blocksRef.current = next;
      updateContentBlocks(next);
    },
    [],
  );

  const countAttachments = (blocks: ExtendedContentBlock[], files: File[]) => ({
    images:
      blocks.filter((block) => block.type === "image").length +
      files.filter((file) => file.type.startsWith("image/")).length,
    pdfs:
      blocks.filter(
        (block) =>
          block.type === "file" &&
          ((block as any).mimeType === "application/pdf" ||
            (block as any).mime_type === "application/pdf"),
      ).length + files.filter((file) => file.type === "application/pdf").length,
  });

  // All entry points reserve capacity synchronously, including unfinished uploads.
  const uploadFiles = useCallback(
    async (files: File[]) => {
      const uniqueFiles: File[] = [];
      const duplicates: File[] = [];
      const invalid = files.filter(
        (file) => !SUPPORTED_FILE_TYPES.includes(file.type),
      );
      for (const file of files.filter((file) =>
        SUPPORTED_FILE_TYPES.includes(file.type),
      )) {
        const duplicate =
          [...pendingRef.current, ...uniqueFiles].some(
            (pending) =>
              pending.type === file.type && pending.name === file.name,
          ) ||
          blocksRef.current.some((block) => {
            const mime = (block as any).mimeType || (block as any).mime_type;
            const name =
              (block as any).metadata?.filename ||
              (block as any).metadata?.name;
            return mime === file.type && name === file.name;
          });
        (duplicate ? duplicates : uniqueFiles).push(file);
      }
      if (invalid.length) {
        toast.error(
          "Unsupported file type. Please upload a JPEG, PNG, GIF, WEBP image or a PDF.",
        );
      }
      if (duplicates.length) {
        toast.error(
          `Duplicate file(s) detected: ${duplicates.map((file) => file.name).join(", ")}. Each file can only be uploaded once per message.`,
        );
      }
      if (!uniqueFiles.length) return;
      const nextCount = countAttachments(blocksRef.current, [
        ...pendingRef.current,
        ...uniqueFiles,
      ]);
      if (
        nextCount.images > MAX_IMAGE_ATTACHMENTS ||
        nextCount.pdfs > MAX_PDF_ATTACHMENTS
      ) {
        toast.error(
          "Each message allows up to 20 images and 2 PDFs. No files from this selection were uploaded. Remove attachments or choose fewer files.",
        );
        return;
      }
      const version = draftVersion.current;
      pendingRef.current = [...pendingRef.current, ...uniqueFiles];
      setPendingFiles(pendingRef.current);
      const results = await Promise.allSettled(
        uniqueFiles.map(fileToContentBlock),
      );
      if (version !== draftVersion.current) return;
      // Keep successful uploads if another upload fails, and release every reservation.
      const newBlocks = results.flatMap((result) =>
        result.status === "fulfilled" ? [result.value] : [],
      );
      setContentBlocks((previous) => [...previous, ...newBlocks]);
      pendingRef.current = pendingRef.current.filter(
        (file) => !uniqueFiles.includes(file),
      );
      setPendingFiles(pendingRef.current);
    },
    [setContentBlocks],
  );

  const handleFileUpload = async (e: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    e.target.value = "";
    await uploadFiles(files);
  };

  // Drag and drop handlers
  useEffect(() => {
    if (!dropRef.current) return;

    // Global drag events with counter for robust dragOver state
    const handleWindowDragEnter = (e: DragEvent) => {
      if (e.dataTransfer?.types?.includes("Files")) {
        dragCounter.current += 1;
        setDragOver(true);
      }
    };
    const handleWindowDragLeave = (e: DragEvent) => {
      if (e.dataTransfer?.types?.includes("Files")) {
        dragCounter.current -= 1;
        if (dragCounter.current <= 0) {
          setDragOver(false);
          dragCounter.current = 0;
        }
      }
    };
    const handleWindowDrop = async (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      dragCounter.current = 0;
      setDragOver(false);

      if (!e.dataTransfer) return;

      await uploadFiles(Array.from(e.dataTransfer.files));
    };
    const handleWindowDragEnd = (e: DragEvent) => {
      dragCounter.current = 0;
      setDragOver(false);
    };
    window.addEventListener("dragenter", handleWindowDragEnter);
    window.addEventListener("dragleave", handleWindowDragLeave);
    window.addEventListener("drop", handleWindowDrop);
    window.addEventListener("dragend", handleWindowDragEnd);

    // Prevent default browser behavior for dragover globally
    const handleWindowDragOver = (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener("dragover", handleWindowDragOver);

    // Remove element-specific drop event (handled globally)
    const handleDragOver = (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setDragOver(true);
    };
    const handleDragEnter = (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setDragOver(true);
    };
    const handleDragLeave = (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setDragOver(false);
    };
    const element = dropRef.current;
    element.addEventListener("dragover", handleDragOver);
    element.addEventListener("dragenter", handleDragEnter);
    element.addEventListener("dragleave", handleDragLeave);

    return () => {
      element.removeEventListener("dragover", handleDragOver);
      element.removeEventListener("dragenter", handleDragEnter);
      element.removeEventListener("dragleave", handleDragLeave);
      window.removeEventListener("dragenter", handleWindowDragEnter);
      window.removeEventListener("dragleave", handleWindowDragLeave);
      window.removeEventListener("drop", handleWindowDrop);
      window.removeEventListener("dragend", handleWindowDragEnd);
      window.removeEventListener("dragover", handleWindowDragOver);
      dragCounter.current = 0;
    };
  }, [uploadFiles]);

  const removeBlock = (idx: number) => {
    setContentBlocks((prev) => prev.filter((_, i) => i !== idx));
  };

  const resetBlocks = () => {
    draftVersion.current += 1;
    pendingRef.current = [];
    setPendingFiles([]);
    setContentBlocks([]);
  };

  /**
   * Handle paste event for files (images, PDFs)
   * Can be used as onPaste={handlePaste} on a textarea or input
   */
  const handlePaste = async (
    e: React.ClipboardEvent<HTMLTextAreaElement | HTMLInputElement>,
  ) => {
    const items = e.clipboardData.items;
    if (!items) return;
    const files: File[] = [];
    for (let i = 0; i < items.length; i += 1) {
      const item = items[i];
      if (item.kind === "file") {
        const file = item.getAsFile();
        if (file) files.push(file);
      }
    }
    if (files.length === 0) {
      return;
    }
    e.preventDefault();
    await uploadFiles(files);
  };

  return {
    contentBlocks,
    setContentBlocks,
    handleFileUpload,
    dropRef,
    removeBlock,
    resetBlocks,
    dragOver,
    handlePaste,
    isUploading,
    attachmentCounts: countAttachments(contentBlocks, pendingFiles),
  };
}
