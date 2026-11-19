import { equal, match, rejects } from "node:assert/strict";
import { test } from "node:test";
import { pollRouteStatus } from "./pollRouteStatus";

const notFound = Object.assign(new Error("Not found"), {
  isAxiosError: true,
  response: { status: 404 },
});

test("reports completion only for Squid success", async () => {
  const signal = new AbortController().signal;
  const success = await pollRouteStatus(async () => "success", signal);
  equal(success.status, "success");
  equal(success.message, "Squid reports that the swap completed.");

  for (const status of ["partial_success", "needs_gas", "refund", "refunded", "failed_on_destination"]) {
    const result = await pollRouteStatus(async () => status, signal);
    equal(result.status, status);
    equal(result.message.includes("swap completed"), false);
  }
});

test("retries unindexed routes, missing status, and ongoing routes until success", async () => {
  const signal = new AbortController().signal;
  const statuses = [notFound, "not_found", undefined, "ongoing", "success"];
  const result = await pollRouteStatus(async (requestSignal) => {
    equal(requestSignal, signal);
    const status = statuses.shift();
    if (status instanceof Error) {
      throw status;
    }
    return status;
  }, signal, 0);
  equal(result.status, "success");
  equal(statuses.length, 0);
});

for (const status of ["ongoing", "not_found", notFound]) {
  test(`times out during ${status instanceof Error ? "consecutive HTTP 404s" : status}`, async () => {
    const controller = new AbortController();
    let polls = 0;
    const result = await pollRouteStatus(async () => {
      if (++polls === 3) {
        controller.abort();
      }
      if (status instanceof Error) {
        throw status;
      }
      return status;
    }, controller.signal, 0);
    equal(polls, 3);
    equal(result.status, "timeout");
    match(result.message, /Timed out/);
    equal(result.message.includes("swap completed"), false);
  });
}

test("passes the deadline signal to an in-flight status request", async () => {
  const controller = new AbortController();
  const result = pollRouteStatus((signal) => new Promise((_, reject) => {
    signal.addEventListener("abort", () => reject(signal.reason), { once: true });
  }), controller.signal);
  controller.abort();
  equal((await result).status, "timeout");
});

test("propagates errors unrelated to indexing or the deadline", async () => {
  const serverError = Object.assign(new Error("Service unavailable"), {
    isAxiosError: true,
    response: { status: 503 },
  });
  await rejects(pollRouteStatus(async () => {
    throw serverError;
  }, new AbortController().signal), serverError);
});
