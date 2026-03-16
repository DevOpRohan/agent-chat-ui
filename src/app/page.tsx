"use client";

import { Thread } from "@/components/thread";
import { ThreadRuntimeProvider } from "@/providers/Stream";
import { ThreadProvider } from "@/providers/Thread";
import { ArtifactProvider } from "@/components/thread/artifact";
import { Toaster } from "@/components/ui/sonner";
import React from "react";

export default function DemoPage(): React.ReactNode {
  return (
    <React.Suspense fallback={<div>Loading (layout)...</div>}>
      <Toaster />
      <ThreadProvider>
        <ThreadRuntimeProvider>
          <ArtifactProvider>
            <Thread />
          </ArtifactProvider>
        </ThreadRuntimeProvider>
      </ThreadProvider>
    </React.Suspense>
  );
}
