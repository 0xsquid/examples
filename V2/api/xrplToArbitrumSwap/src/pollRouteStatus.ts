import axios from "axios";
import { setTimeout as delay } from "node:timers/promises";

const terminalMessages = {
  success: "Squid reports that the swap completed.",
  partial_success: "Squid reports partial success. Check the destination transaction.",
  needs_gas: "Squid reports that the route needs gas. Check the route in SquidScan.",
  refund: "Squid reports a refund. Check the source chain.",
  refunded: "Squid reports a refund. Check the source chain.",
  failed_on_destination: "Squid reports that the destination transaction failed.",
} as const;

type TerminalStatus = keyof typeof terminalMessages;

function isTerminalStatus(status: string): status is TerminalStatus {
  return Object.prototype.hasOwnProperty.call(terminalMessages, status);
}

export async function pollRouteStatus(
  getStatus: (signal: AbortSignal) => Promise<string | undefined>,
  signal: AbortSignal,
  pollIntervalMs = 5000
): Promise<{ status: TerminalStatus | "timeout"; message: string }> {
  let lastStatus: string | undefined;

  try {
    while (!signal.aborted) {
      try {
        lastStatus = await getStatus(signal);
      } catch (error) {
        if (!axios.isAxiosError(error) || error.response?.status !== 404) {
          throw error;
        }
        lastStatus = "not_found";
      }

      if (!signal.aborted && lastStatus && isTerminalStatus(lastStatus)) {
        return { status: lastStatus, message: terminalMessages[lastStatus] };
      }

      // A route may return not_found or HTTP 404 while the source transaction is being indexed.
      await delay(pollIntervalMs, undefined, { signal });
    }
  } catch (error) {
    if (!signal.aborted) {
      throw error;
    }
  }

  return {
    status: "timeout",
    message: `Timed out waiting for Squid route status (last status: ${lastStatus ?? "unknown"}). Check the route in SquidScan.`,
  };
}
