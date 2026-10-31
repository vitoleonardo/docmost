import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createStore, Provider } from "jotai";
import { MemoryRouter } from "react-router-dom";
import deDE from "../../../../public/locales/de-DE/translation.json";
import Aside from "@/components/layouts/global/aside.tsx";
import { asideStateAtom } from "@/components/layouts/global/hooks/atoms/sidebar-atom.ts";
import AiAssistantTrigger from "./ai-assistant-trigger.tsx";
import api from "@/lib/api-client";
import PageHeaderMenu from "@/features/page/components/header/page-header-menu.tsx";
import type { AiAssistantStatus } from "@/features/ai-assistant/types/ai-assistant.types.ts";

vi.mock("react-i18next", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-i18next")>()),
  useTranslation: () => ({
    t: (key: string) => (deDE as Record<string, string>)[key] ?? key,
  }),
}));

vi.mock("@/lib/api-client", () => ({
  default: { post: vi.fn() },
}));

vi.mock("@/features/page/queries/page-query.ts", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@/features/page/queries/page-query.ts")
  >()),
  usePageQuery: () => ({
    data: {
      id: "page-1",
      slugId: "slug-1",
      title: "Seite",
      spaceId: "space-1",
      createdAt: "2026-09-01T08:30:00.000Z",
      updatedAt: "2026-10-01T08:30:00.000Z",
      lastUpdatedBy: { name: "Test User" },
    },
  }),
}));

vi.mock("@/main.tsx", async () => ({
  queryClient: new (await import("@tanstack/react-query")).QueryClient(),
}));

vi.mock("@/ee/page-permission", () => ({ PageShareModal: () => null }));

vi.mock("@/ee/page-verification", () => ({
  PageVerificationMenuItem: () => null,
  PageVerificationModal: () => null,
}));

const statusMock = vi.mocked(api.post);

const UNAVAILABLE_TEXT =
  "Der Assistent ist gerade nicht erreichbar. Das Wiki funktioniert normal weiter.";

function answerWith(status: AiAssistantStatus) {
  statusMock.mockResolvedValueOnce({ data: { status } });
}

function renderAssistant() {
  const store = createStore();
  const client = new QueryClient();
  render(
    <MantineProvider>
      <QueryClientProvider client={client}>
        <Provider store={store}>
          <MemoryRouter>
            <AiAssistantTrigger />
            <Aside />
          </MemoryRouter>
        </Provider>
      </QueryClientProvider>
    </MantineProvider>,
  );
  return store;
}

beforeAll(() => {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener() {},
    removeListener() {},
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent: () => false,
  }));
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});

beforeEach(() => {
  statusMock.mockReset();
});

describe("ai assistant", () => {
  it("BRIDGE-AC2: shows no trigger while the assistant is disabled", async () => {
    answerWith("disabled");
    renderAssistant();
    await waitFor(() => expect(statusMock).toHaveBeenCalledTimes(1));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.queryByRole("button", { name: "Assistent" })).toBeNull();
  });

  it("BRIDGE-AC2: shows no trigger while the status is still loading", () => {
    statusMock.mockReturnValueOnce(new Promise(() => {}));
    renderAssistant();
    expect(screen.queryByRole("button", { name: "Assistent" })).toBeNull();
  });

  it("BRIDGE-AC5: the trigger opens the assistant in the aside and shows the empty state", async () => {
    statusMock.mockResolvedValue({ data: { status: "available" } });
    const store = renderAssistant();
    fireEvent.click(await screen.findByRole("button", { name: "Assistent" }));
    expect(store.get(asideStateAtom)).toEqual({
      tab: "ai-assistant",
      isAsideOpen: true,
    });
    expect(
      (await screen.findByRole("heading", { level: 2 })).textContent,
    ).toBe("Assistent");
    expect(await screen.findByText("Frag das Wiki")).toBeTruthy();
    expect(
      screen.getByText(
        "Antworten stützen sich nur auf Seiten, die du sehen darfst, und nennen ihre Quellen.",
      ),
    ).toBeTruthy();
  });

  it("BRIDGE-AC6: an unavailable assistant shows the notice and a retry button", async () => {
    statusMock.mockResolvedValue({ data: { status: "unavailable" } });
    const store = renderAssistant();
    fireEvent.click(await screen.findByRole("button", { name: "Assistent" }));
    expect(store.get(asideStateAtom).tab).toBe("ai-assistant");
    expect(await screen.findByText(UNAVAILABLE_TEXT)).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Erneut versuchen" }),
    ).toBeTruthy();
  });

  it("BRIDGE-AC6: a failed status request counts as unavailable", async () => {
    statusMock.mockRejectedValue(new Error("Network Error"));
    renderAssistant();
    fireEvent.click(await screen.findByRole("button", { name: "Assistent" }));
    expect(await screen.findByText(UNAVAILABLE_TEXT)).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Erneut versuchen" }),
    ).toBeTruthy();
  });

  it("BRIDGE-AC7: retry recovers once the assistant is available", async () => {
    answerWith("unavailable");
    renderAssistant();
    fireEvent.click(await screen.findByRole("button", { name: "Assistent" }));
    const retry = await screen.findByRole("button", {
      name: "Erneut versuchen",
    });
    answerWith("available");
    fireEvent.click(retry);
    expect(await screen.findByText("Frag das Wiki")).toBeTruthy();
    expect(screen.queryByText(UNAVAILABLE_TEXT)).toBeNull();
  });

  it("BRIDGE-AC42: retry while still down shows the notice again, one request per click", async () => {
    statusMock.mockResolvedValue({ data: { status: "unavailable" } });
    renderAssistant();
    fireEvent.click(await screen.findByRole("button", { name: "Assistent" }));
    const retry = await screen.findByRole("button", {
      name: "Erneut versuchen",
    });
    expect(statusMock).toHaveBeenCalledTimes(1);
    fireEvent.click(retry);
    await waitFor(() => expect(statusMock).toHaveBeenCalledTimes(2));
    expect(await screen.findByText(UNAVAILABLE_TEXT)).toBeTruthy();
    await waitFor(() =>
      expect(
        (
          screen.getByRole("button", {
            name: "Erneut versuchen",
          }) as HTMLButtonElement
        ).disabled,
      ).toBe(false),
    );
    expect(statusMock).toHaveBeenCalledTimes(2);
  });

  it("BRIDGE-AC42: extra clicks while the retry is running send no further request", async () => {
    answerWith("unavailable");
    renderAssistant();
    fireEvent.click(await screen.findByRole("button", { name: "Assistent" }));
    const retry = await screen.findByRole("button", {
      name: "Erneut versuchen",
    });
    let finish: (value: { data: { status: AiAssistantStatus } }) => void =
      () => {};
    statusMock.mockReturnValueOnce(
      new Promise((resolve) => (finish = resolve)),
    );
    fireEvent.click(retry);
    fireEvent.click(retry);
    fireEvent.click(retry);
    expect(statusMock).toHaveBeenCalledTimes(2);
    finish({ data: { status: "unavailable" } });
    expect(await screen.findByText(UNAVAILABLE_TEXT)).toBeTruthy();
  });

  it("BRIDGE-AC5: the trigger sits right before the comments button", async () => {
    statusMock.mockResolvedValue({ data: { status: "available" } });
    const client = new QueryClient();
    render(
      <MantineProvider>
        <QueryClientProvider client={client}>
          <Provider store={createStore()}>
            <MemoryRouter>
              <PageHeaderMenu />
            </MemoryRouter>
          </Provider>
        </QueryClientProvider>
      </MantineProvider>,
    );
    const trigger = await screen.findByRole("button", { name: "Assistent" });
    const comments = screen.getByRole("button", { name: "Kommentare" });
    expect(trigger.nextElementSibling).toBe(comments);
  });
});
