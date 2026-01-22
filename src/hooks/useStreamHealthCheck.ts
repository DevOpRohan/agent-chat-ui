import { useEffect, useRef, useCallback } from "react";
import { Client } from "@langchain/langgraph-sdk";

interface UseStreamHealthCheckOptions {
    /**
     * The thread ID to monitor. If null, polling is disabled.
     */
    threadId: string | null;
    /**
     * Whether the stream is currently loading/active.
     */
    isLoading: boolean;
    /**
     * The LangGraph SDK client instance.
     */
    client: Client;
    /**
     * Callback to refresh thread state when stalled stream is detected.
     * This should trigger a re-fetch of thread state.
     */
    onStateRefresh: () => void;
    /**
     * Interval in milliseconds between polling checks.
     * @default 30000 (30 seconds)
     */
    pollIntervalMs?: number;
    /**
     * If true, enables debug logging to console.
     * @default false
     */
    debug?: boolean;
}

/**
 * Hook to monitor stream health and detect stalled connections.
 * 
 * When the stream appears to be loading but no events are received for
 * the poll interval, this hook will call onStateRefresh to trigger
 * a state sync with the backend.
 * 
 * This helps handle cases where the SSE connection silently drops during
 * long-running tool executions.
 */
export function useStreamHealthCheck({
    threadId,
    isLoading,
    client,
    onStateRefresh,
    pollIntervalMs = 30000,
    debug = false,
}: UseStreamHealthCheckOptions): void {
    const lastActivityRef = useRef<number>(Date.now());
    const intervalRef = useRef<NodeJS.Timeout | null>(null);

    const log = useCallback(
        (...args: unknown[]) => {
            if (debug) {
                console.log("[StreamHealthCheck]", ...args);
            }
        },
        [debug]
    );

    // Update last activity timestamp whenever isLoading changes
    // This resets the "stall detection" timer when new activity occurs
    useEffect(() => {
        lastActivityRef.current = Date.now();
        log("Activity detected, resetting timer");
    }, [isLoading, log]);

    // Main polling effect
    useEffect(() => {
        // Don't poll if:
        // - No thread ID (nothing to poll)
        // - Not loading (stream is idle, no need to poll)
        if (!threadId || !isLoading) {
            if (intervalRef.current) {
                clearInterval(intervalRef.current);
                intervalRef.current = null;
                log("Polling stopped - not loading or no threadId");
            }
            return;
        }

        log("Starting health check polling, interval:", pollIntervalMs);

        const checkHealth = async () => {
            const now = Date.now();
            const timeSinceActivity = now - lastActivityRef.current;

            log(
                "Health check - time since last activity:",
                Math.round(timeSinceActivity / 1000),
                "seconds"
            );

            // If we've been "loading" for longer than the poll interval
            // without receiving updates, the stream might be stalled
            if (timeSinceActivity >= pollIntervalMs) {
                log("Stream appears stalled, checking backend state...");

                try {
                    // Try to get the current thread state from the backend
                    const state = await client.threads.getState(threadId);

                    if (state) {
                        log("Backend state fetched, triggering refresh");
                        // Reset activity timer since we just got data
                        lastActivityRef.current = Date.now();
                        // Trigger the refresh callback
                        onStateRefresh();
                    }
                } catch (error) {
                    log("Error fetching thread state:", error);
                    // Don't throw - polling should be resilient to errors
                }
            }
        };

        // Start polling
        intervalRef.current = setInterval(checkHealth, pollIntervalMs);

        // Run an initial check after a short delay
        const initialCheckTimeout = setTimeout(() => {
            checkHealth();
        }, pollIntervalMs);

        return () => {
            if (intervalRef.current) {
                clearInterval(intervalRef.current);
                intervalRef.current = null;
            }
            clearTimeout(initialCheckTimeout);
            log("Polling cleanup");
        };
    }, [threadId, isLoading, client, onStateRefresh, pollIntervalMs, log]);
}
