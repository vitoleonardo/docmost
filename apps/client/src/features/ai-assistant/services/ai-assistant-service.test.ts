import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { askQuestion } from "@/features/ai-assistant/services/ai-assistant-service.ts";
import type {
  AskEvent,
  AskRequestErrorCode,
  IAskRequest,
  IAskSource,
} from "@/features/ai-assistant/types/ai-assistant.types.ts";

const BODY: IAskRequest = {
  question: "Wann ist die Kernarbeitszeit?",
  conversationId: "3f2b8a52-5c1e-4a56-9c43-0f0c3a1d9a11",
};

const SOURCE: IAskSource = {
  number: 1,
  pageId: "page-1",
  title: "Arbeitszeit",
  spaceName: "Allgemein",
  headingPath: ["Regeln"],
  fileName: null,
  pdfPage: null,
  url: "/s/allgemein/p/arbeitszeit-slug",
};

const encoder = new TextEncoder();

function frame(event: AskEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

function streamOfChunks(chunks: string[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

function mockFetch(response: Response) {
  const fetchMock = vi.fn().mockResolvedValue(response);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function sseResponse(chunks: string[]): Response {
  return new Response(streamOfChunks(chunks), {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}

async function collect(chunks: string[]): Promise<AskEvent[]> {
  mockFetch(sseResponse(chunks));
  const events: AskEvent[] = [];
  await askQuestion(BODY, (event) => events.push(event), new AbortController().signal);
  return events;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("askQuestion", () => {
  it("ASK-AC9: posts JSON with the session cookie to /api/ai/ask", async () => {
    const fetchMock = mockFetch(sseResponse([frame({ type: "no_source" })]));
    const signal = new AbortController().signal;

    await askQuestion(BODY, () => undefined, signal);

    expect(fetchMock).toHaveBeenCalledWith("/api/ai/ask", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(BODY),
      signal,
    });
  });

  it("ASK-AC9: delivers several frames that arrive in one chunk", async () => {
    const events = await collect([
      frame({ type: "delta", text: "Die " }) +
        frame({ type: "delta", text: "Kernzeit" }) +
        frame({ type: "sources", sources: [SOURCE] }),
    ]);

    expect(events).toEqual([
      { type: "delta", text: "Die " },
      { type: "delta", text: "Kernzeit" },
      { type: "sources", sources: [SOURCE] },
    ]);
  });

  it("ASK-AC9: reassembles a frame split mid-JSON and mid-'data:'", async () => {
    const whole = frame({ type: "delta", text: "Grüße" }) + frame({ type: "no_source" });
    const splitInsideUmlaut = whole.indexOf("ü");

    const events = await collect([
      whole.slice(0, 3),
      whole.slice(3, 20),
      whole.slice(20, splitInsideUmlaut),
      whole.slice(splitInsideUmlaut),
    ]);

    expect(events).toEqual([
      { type: "delta", text: "Grüße" },
      { type: "no_source" },
    ]);
  });

  it("ASK-AC9: decodes a multi-byte character split across chunks", async () => {
    const bytes = encoder.encode(frame({ type: "delta", text: "ü" }));
    const umlautAt = bytes.indexOf(0xc3);
    mockFetch(
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(bytes.slice(0, umlautAt + 1));
            controller.enqueue(bytes.slice(umlautAt + 1));
            controller.close();
          },
        }),
        { status: 200 },
      ),
    );
    const events: AskEvent[] = [];

    await askQuestion(BODY, (event) => events.push(event), new AbortController().signal).catch(
      () => undefined,
    );

    expect(events).toEqual([{ type: "delta", text: "ü" }, { type: "error", code: "model_unavailable" }]);
  });

  it("ASK-AC66: a stream that ends without a final event becomes model_unavailable", async () => {
    const events = await collect([frame({ type: "delta", text: "Teil" })]);

    expect(events).toEqual([
      { type: "delta", text: "Teil" },
      { type: "error", code: "model_unavailable" },
    ]);
  });

  it("ASK-AC66: does not add an error after a final event", async () => {
    const events = await collect([frame({ type: "no_source" })]);

    expect(events).toEqual([{ type: "no_source" }]);
  });

  it.each<[number, AskRequestErrorCode]>([
    [400, "invalid_request"],
    [404, "space_not_found"],
    [404, "page_not_found"],
    [503, "assistant_disabled"],
    [503, "assistant_unavailable"],
  ])("ASK-AC66: maps HTTP %i with code %s to a typed error", async (status, code) => {
    mockFetch(new Response(JSON.stringify({ code, message: "x" }), { status }));

    await expect(
      askQuestion(BODY, () => undefined, new AbortController().signal),
    ).rejects.toMatchObject({ name: "AskRequestError", code });
  });

  it("ASK-AC66: maps 401 without a code to unauthorized", async () => {
    mockFetch(new Response(JSON.stringify({ message: "Unauthorized" }), { status: 401 }));

    await expect(
      askQuestion(BODY, () => undefined, new AbortController().signal),
    ).rejects.toMatchObject({ code: "unauthorized" });
  });

  it("ASK-AC66: maps a non-JSON error body to assistant_unavailable", async () => {
    mockFetch(new Response("<html>bad gateway</html>", { status: 502 }));

    await expect(
      askQuestion(BODY, () => undefined, new AbortController().signal),
    ).rejects.toMatchObject({ code: "assistant_unavailable" });
  });

  it("ASK-AC66: maps a network failure to assistant_unavailable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));

    await expect(
      askQuestion(BODY, () => undefined, new AbortController().signal),
    ).rejects.toMatchObject({ code: "assistant_unavailable" });
  });

  it("ASK-AC12: rethrows the abort so the caller can mark the turn stopped", async () => {
    const controller = new AbortController();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((_url, init: RequestInit) => {
        return new Promise((_resolve, reject) => {
          init.signal!.addEventListener("abort", () =>
            reject(new DOMException("aborted", "AbortError")),
          );
        });
      }),
    );

    const pending = askQuestion(BODY, () => undefined, controller.signal);
    controller.abort();

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  });
});

describe("contract", () => {
  const contract = JSON.parse(
    readFileSync(join(__dirname, "../../../../../../docs/contracts/ai-bridge.json"), "utf8"),
  ) as {
    endpoints: {
      path: string;
      request: string[];
      events: Record<string, string[]>;
      values: Record<string, string[]>;
      errors: string[];
    }[];
  };
  const ask = contract.endpoints.find((endpoint) => endpoint.path === "/api/ai/ask")!;

  it("ASK-AC9: client request, event and source fields equal the contract", () => {
    const request: Record<keyof IAskRequest, true> = {
      question: true,
      conversationId: true,
      spaceId: true,
      pageId: true,
    };
    const source: Record<keyof IAskSource, true> = {
      number: true,
      pageId: true,
      title: true,
      spaceName: true,
      headingPath: true,
      fileName: true,
      pdfPage: true,
      url: true,
    };
    const eventTypes: Record<AskEvent["type"], true> = {
      delta: true,
      sources: true,
      no_source: true,
      error: true,
    };

    expect(Object.keys(request).sort()).toEqual([...ask.request].sort());
    expect(Object.keys(source).sort()).toEqual(
      ask.events.sources
        .filter((field) => field.startsWith("sources[]."))
        .map((field) => field.slice("sources[].".length))
        .sort(),
    );
    expect(Object.keys(eventTypes).sort()).toEqual(Object.keys(ask.events).sort());
  });

  it("ASK-AC66: client error codes cover the contract's errors", () => {
    const handled: AskRequestErrorCode[] = [
      "invalid_request",
      "space_not_found",
      "page_not_found",
      "assistant_disabled",
      "assistant_unavailable",
      "unauthorized",
    ];

    expect(handled).toEqual(expect.arrayContaining(ask.errors as AskRequestErrorCode[]));
    expect(ask.values.errorCode).toEqual(["model_unavailable"]);
  });
});
