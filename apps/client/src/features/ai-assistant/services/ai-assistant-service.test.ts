import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import api from "@/lib/api-client";
import {
  AgentProposalError,
  AgentRequestError,
  applyAgentProposal,
  askQuestion,
  discardAgentProposal,
  getAgentProposal,
  runAgentTask,
  extractContract,
  ExtractRequestError,
} from "@/features/ai-assistant/services/ai-assistant-service.ts";
import { askEventSchema } from "@/features/ai-assistant/types/ai-assistant.types.ts";
import type {
  AgentEvent,
  AgentProposalErrorCode,
  AgentRequestErrorCode,
  AskEvent,
  AskRequestErrorCode,
  IAskRequest,
  IAskSource,
} from "@/features/ai-assistant/types/ai-assistant.types.ts";

vi.mock("@/lib/api-client", () => ({
  default: { post: vi.fn() },
}));

const postMock = vi.mocked(api.post);

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
  await askQuestion(
    BODY,
    (event) => events.push(event),
    new AbortController().signal,
  );
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
    const whole =
      frame({ type: "delta", text: "Grüße" }) + frame({ type: "no_source" });
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

    await askQuestion(
      BODY,
      (event) => events.push(event),
      new AbortController().signal,
    ).catch(() => undefined);

    expect(events).toEqual([
      { type: "delta", text: "ü" },
      { type: "error", code: "model_unavailable" },
    ]);
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

  it.each([
    ["a delta without text", 'data: {"type":"delta"}\n\n'],
    ["an unknown event type", 'data: {"type":"other"}\n\n'],
    ["an error with an unknown code", 'data: {"type":"error","code":"x"}\n\n'],
    [
      "a source with a missing field",
      'data: {"type":"sources","sources":[{"number":1}]}\n\n',
    ],
    ["a frame that is not JSON", "data: {oops\n\n"],
  ])(
    "ASK-AC66: %s ends the stream as model_unavailable",
    async (_name, malformed) => {
      const events = await collect([
        frame({ type: "delta", text: "Teil" }),
        malformed,
        frame({ type: "delta", text: "danach" }),
      ]);

      expect(events).toEqual([
        { type: "delta", text: "Teil" },
        { type: "error", code: "model_unavailable" },
      ]);
    },
  );

  it.each<[number, AskRequestErrorCode]>([
    [400, "invalid_request"],
    [404, "space_not_found"],
    [404, "page_not_found"],
    [503, "assistant_disabled"],
    [503, "assistant_unavailable"],
  ])(
    "ASK-AC66: maps HTTP %i with code %s to a typed error",
    async (status, code) => {
      mockFetch(
        new Response(JSON.stringify({ code, message: "x" }), { status }),
      );

      await expect(
        askQuestion(BODY, () => undefined, new AbortController().signal),
      ).rejects.toMatchObject({ name: "AskRequestError", code });
    },
  );

  it("ASK-AC66: maps 401 without a code to unauthorized", async () => {
    mockFetch(
      new Response(JSON.stringify({ message: "Unauthorized" }), {
        status: 401,
      }),
    );

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
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new TypeError("Failed to fetch")),
    );

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
    readFileSync(
      join(__dirname, "../../../../../../docs/contracts/ai-bridge.json"),
      "utf8",
    ),
  ) as {
    endpoints: {
      path: string;
      request: string[];
      events: Record<string, string[]>;
      values: Record<string, string[]>;
      errors: string[];
    }[];
  };
  const ask = contract.endpoints.find(
    (endpoint) => endpoint.path === "/api/ai/ask",
  )!;

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
    expect(Object.keys(eventTypes).sort()).toEqual(
      Object.keys(ask.events).sort(),
    );
  });

  it("ASK-AC9: the event schema keys equal the contract's event fields", () => {
    const shapes = Object.fromEntries(
      askEventSchema.options.map((option) => [
        option.shape.type.value,
        option.shape as Record<string, any>,
      ]),
    );
    const contractKeys = Object.fromEntries(
      Object.entries(ask.events).map(([type, fields]) => [
        type,
        [...new Set(fields.map((field) => field.split("[]")[0]))].sort(),
      ]),
    );

    expect(
      Object.fromEntries(
        Object.entries(shapes).map(([type, shape]) => [
          type,
          Object.keys(shape).sort(),
        ]),
      ),
    ).toEqual(contractKeys);
    expect(Object.keys(shapes.sources.sources.element.shape).sort()).toEqual(
      ask.events.sources
        .filter((field) => field.startsWith("sources[]."))
        .map((field) => field.slice("sources[].".length))
        .sort(),
    );
    expect(shapes.error.code.options).toEqual(ask.values.errorCode);
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

    expect(handled).toEqual(
      expect.arrayContaining(ask.errors as AskRequestErrorCode[]),
    );
    expect(ask.values.errorCode).toEqual(["model_unavailable"]);
  });
});

const EXTRACTED_FIELDS = [
  {
    key: "parties",
    value: "Acme GmbH",
    quote: "Zwischen Acme GmbH",
    pdfPage: 1,
  },
  { key: "term", value: null, quote: null, pdfPage: null },
  { key: "noticePeriod", value: null, quote: null, pdfPage: null },
  { key: "value", value: null, quote: null, pdfPage: null },
  { key: "renewal", value: null, quote: null, pdfPage: null },
];

function httpError(status: number, code?: string) {
  return Object.assign(new Error("request failed"), {
    response: { status, data: { code, message: "x" } },
  });
}

async function extractError(rejection: unknown): Promise<unknown> {
  postMock.mockRejectedValueOnce(rejection);
  return extractContract("page-1", "att-1", new AbortController().signal).catch(
    (error) => error,
  );
}

describe("extractContract", () => {
  it("EXTRACT-AC9: posts page and attachment id with the signal and parses an extracted result", async () => {
    postMock.mockResolvedValueOnce({
      data: { outcome: "extracted", fields: EXTRACTED_FIELDS },
    });
    const signal = new AbortController().signal;

    const result = await extractContract("page-1", "att-1", signal);

    expect(postMock).toHaveBeenCalledWith(
      "/ai/extract",
      { pageId: "page-1", attachmentId: "att-1" },
      { signal },
    );
    expect(result).toEqual({ outcome: "extracted", fields: EXTRACTED_FIELDS });
  });

  it("EXTRACT-AC33: parses a refused result with counts", async () => {
    const refused = {
      outcome: "refused",
      reason: "too_many_pages",
      pageCount: 11,
      fileSize: null,
      characterCount: null,
    };
    postMock.mockResolvedValueOnce({ data: refused });
    expect(
      await extractContract("p", "a", new AbortController().signal),
    ).toEqual(refused);
  });

  it("EXTRACT-AC38: parses a failed result", async () => {
    postMock.mockResolvedValueOnce({
      data: { outcome: "failed", reason: "model_unavailable" },
    });
    expect(
      await extractContract("p", "a", new AbortController().signal),
    ).toEqual({ outcome: "failed", reason: "model_unavailable" });
  });

  it.each([
    ["an unknown outcome", { outcome: "other" }],
    [
      "four fields",
      { outcome: "extracted", fields: EXTRACTED_FIELDS.slice(1) },
    ],
    [
      "a duplicated key",
      {
        outcome: "extracted",
        fields: [...EXTRACTED_FIELDS.slice(0, 4), EXTRACTED_FIELDS[0]],
      },
    ],
    [
      "an unknown refusal reason",
      {
        outcome: "refused",
        reason: "x",
        pageCount: null,
        fileSize: null,
        characterCount: null,
      },
    ],
  ])("EXTRACT-AC40: rejects %s as a model error", async (_name, body) => {
    postMock.mockResolvedValueOnce({ data: body });
    const error = await extractContract(
      "p",
      "a",
      new AbortController().signal,
    ).catch((caught) => caught);
    expect(error).toBeInstanceOf(ExtractRequestError);
    expect(error.code).toBe("model");
  });

  it.each([
    [403, "page_not_editable"],
    [404, "page_not_found"],
    [404, "attachment_not_found"],
  ])("EXTRACT-AC42: maps HTTP %i %s to not_available", async (status, code) => {
    const error = (await extractError(
      httpError(status, code),
    )) as ExtractRequestError;
    expect(error).toBeInstanceOf(ExtractRequestError);
    expect(error.code).toBe("not_available");
  });

  it.each(["assistant_unavailable", "assistant_disabled"])(
    "EXTRACT-AC41: maps HTTP 503 %s to unreachable",
    async (code) => {
      const error = (await extractError(
        httpError(503, code),
      )) as ExtractRequestError;
      expect(error.code).toBe("unreachable");
    },
  );

  it("EXTRACT-AC41: maps a network error without response to unreachable", async () => {
    const error = (await extractError(
      new Error("Network Error"),
    )) as ExtractRequestError;
    expect(error.code).toBe("unreachable");
  });

  it("EXTRACT-AC8: rethrows the abort instead of mapping it", async () => {
    const controller = new AbortController();
    const abort = Object.assign(new Error("canceled"), {
      code: "ERR_CANCELED",
    });
    postMock.mockImplementationOnce(async () => {
      controller.abort();
      throw abort;
    });
    await expect(extractContract("p", "a", controller.signal)).rejects.toBe(
      abort,
    );
  });
});

const AGENT_BODY = { spaceId: "space-1", task: "Passe Urlaub an" };

function agentFrame(event: AgentEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

async function collectAgent(chunks: string[]): Promise<AgentEvent[]> {
  mockFetch(sseResponse(chunks));
  const events: AgentEvent[] = [];
  await runAgentTask(
    AGENT_BODY,
    (event) => events.push(event),
    new AbortController().signal,
  );
  return events;
}

const MODEL_FAILED: AgentEvent = {
  type: "end",
  outcome: "model_failed",
  pagesRead: 0,
  message: null,
};

describe("runAgentTask", () => {
  it("AGENT-AC49: posts to /api/ai/agent/run and delivers events from one shared frame reader", async () => {
    const run: AgentEvent = { type: "run", runId: "run-1" };
    const step: AgentEvent = {
      type: "step",
      steps: 1,
      label: { kind: "read", title: "Urlaub" },
    };
    const end: AgentEvent = {
      type: "end",
      outcome: "finished",
      pagesRead: 1,
      message: null,
    };
    const fetchMock = mockFetch(
      sseResponse([
        agentFrame(run) + agentFrame(step).slice(0, 10),
        agentFrame(step).slice(10) + agentFrame(end),
      ]),
    );
    const events: AgentEvent[] = [];
    const signal = new AbortController().signal;

    await runAgentTask(AGENT_BODY, (event) => events.push(event), signal);

    expect(fetchMock).toHaveBeenCalledWith("/api/ai/agent/run", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(AGENT_BODY),
      signal,
    });
    expect(events).toEqual([run, step, end]);
  });

  it("AGENT-AC69: a stream that ends without an end event counts as a model failure", async () => {
    const events = await collectAgent([
      agentFrame({ type: "run", runId: "run-1" }),
    ]);

    expect(events).toEqual([{ type: "run", runId: "run-1" }, MODEL_FAILED]);
  });

  it("AGENT-AC69: an invalid event counts as a model failure and stops the stream", async () => {
    const events = await collectAgent([
      'data: {"type":"step","steps":"x"}\n\n' +
        agentFrame({ type: "run", runId: "late" }),
    ]);

    expect(events).toEqual([MODEL_FAILED]);
  });

  it("AGENT-AC69: a rejected fetch throws assistant_unavailable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("network")));

    await expect(
      runAgentTask(AGENT_BODY, () => undefined, new AbortController().signal),
    ).rejects.toMatchObject({ code: "assistant_unavailable" });
  });

  it.each<[number, string, AgentRequestErrorCode]>([
    [400, "invalid_request", "invalid_request"],
    [404, "space_not_found", "space_not_found"],
    [409, "run_in_progress", "run_in_progress"],
    [503, "assistant_disabled", "assistant_disabled"],
    [503, "assistant_unavailable", "assistant_unavailable"],
    [500, "something_else", "assistant_unavailable"],
  ])("AGENT-AC70: %i %s maps to %s", async (status, code, expected) => {
    mockFetch(new Response(JSON.stringify({ code }), { status }));

    const error = await runAgentTask(
      AGENT_BODY,
      () => undefined,
      new AbortController().signal,
    ).catch((caught) => caught);

    expect(error).toBeInstanceOf(AgentRequestError);
    expect(error.code).toBe(expected);
  });

  it("AGENT-AC69: 401 maps to unauthorized", async () => {
    mockFetch(new Response("", { status: 401 }));

    await expect(
      runAgentTask(AGENT_BODY, () => undefined, new AbortController().signal),
    ).rejects.toMatchObject({ code: "unauthorized" });
  });
});

const PROPOSAL_VIEW = {
  id: "prop-1",
  runId: "run-1",
  pageId: "page-1",
  pageTitle: "Urlaub",
  reason: "Tage geändert",
  status: "open",
  canEdit: true,
  added: 1,
  removed: 1,
  changes: [
    {
      heading: null,
      ops: [
        { op: "remove", text: "alt" },
        { op: "add", text: "neu" },
      ],
    },
  ],
};

function proposalFailure(status: number | undefined, code?: string) {
  return status === undefined
    ? new Error("Network Error")
    : { response: { status, data: { code } } };
}

describe("agent proposal calls", () => {
  it("AGENT-AC49: getAgentProposal posts the id and parses the view", async () => {
    postMock.mockResolvedValueOnce({ data: PROPOSAL_VIEW });

    const view = await getAgentProposal("prop-1");

    expect(postMock).toHaveBeenCalledWith("/ai/agent/proposal", {
      proposalId: "prop-1",
    });
    expect(view).toEqual(PROPOSAL_VIEW);
  });

  it("AGENT-AC49: apply and discard post to their routes", async () => {
    postMock.mockResolvedValue({ data: { status: "applied" } });

    await applyAgentProposal("prop-1");
    await discardAgentProposal("prop-1");

    expect(postMock).toHaveBeenCalledWith("/ai/agent/proposal/apply", {
      proposalId: "prop-1",
    });
    expect(postMock).toHaveBeenCalledWith("/ai/agent/proposal/discard", {
      proposalId: "prop-1",
    });
  });

  it("AGENT-AC49: a malformed view maps to unreachable", async () => {
    postMock.mockResolvedValueOnce({ data: { id: "prop-1" } });

    await expect(getAgentProposal("prop-1")).rejects.toMatchObject({
      code: "unreachable",
    });
  });

  it.each<[number | undefined, string | undefined, AgentProposalErrorCode]>([
    [404, "proposal_not_found", "not_found"],
    [404, "page_not_found", "page_gone"],
    [403, "page_not_editable", "not_editable"],
    [403, undefined, "not_editable"],
    [409, "proposal_not_open", "not_open"],
    [409, "proposal_stale", "stale"],
    [503, "write_failed", "write_failed"],
    [503, "assistant_unavailable", "unreachable"],
    [503, "assistant_disabled", "unreachable"],
    [undefined, undefined, "unreachable"],
  ])("AGENT-AC49: %s %s maps to %s", async (status, code, expected) => {
    postMock.mockRejectedValueOnce(proposalFailure(status, code));

    const error = await applyAgentProposal("prop-1").catch((caught) => caught);

    expect(error).toBeInstanceOf(AgentProposalError);
    expect(error.code).toBe(expected);
  });
});
