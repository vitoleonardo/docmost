import { beforeAll, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import { MemoryRouter } from "react-router-dom";
import deDE from "../../../../public/locales/de-DE/translation.json";
import AskAnswer from "./ask-answer.tsx";
import type {
  IAskSource,
  IAskTurn,
} from "@/features/ai-assistant/types/ai-assistant.types.ts";

vi.mock("react-i18next", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-i18next")>()),
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => {
      const template = (deDE as Record<string, string>)[key] ?? key;
      return template.replace(/{{(\w+)}}/g, (_, name) =>
        String(options?.[name] ?? ""),
      );
    },
  }),
}));

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
});

const NO_SOURCE_TEXT =
  "Dazu habe ich in den Seiten, auf die du Zugriff hast, keine passende Quelle gefunden. Formuliere die Frage anders oder wende dich an die zuständige Abteilung.";
const MODEL_ERROR_TEXT =
  "Das Sprachmodell antwortet gerade nicht. Versuche es später noch einmal.";

function source(overrides: Partial<IAskSource>): IAskSource {
  return {
    number: 1,
    pageId: "p1",
    title: "Reisekosten",
    spaceName: "Allgemein",
    headingPath: [],
    fileName: null,
    pdfPage: null,
    url: "/s/allgemein/p/abc",
    ...overrides,
  };
}

function turn(overrides: Partial<IAskTurn>): IAskTurn {
  return {
    id: "t1",
    question: "Frage?",
    answer: "Antwort [1].",
    status: "done",
    sources: [source({})],
    ...overrides,
  };
}

function renderAnswer(value: IAskTurn) {
  return render(
    <MantineProvider>
      <MemoryRouter>
        <AskAnswer turn={value} />
      </MemoryRouter>
    </MantineProvider>,
  );
}

describe("AskAnswer", () => {
  it("ASK-AC17: shows space and one heading level", () => {
    renderAnswer(
      turn({
        sources: [
          source({
            spaceName: "Geschäftsführung",
            headingPath: ["Bänder"],
            url: "/s/gf/p/abc#h1",
          }),
        ],
      }),
    );
    expect(screen.getByText("1. Reisekosten")).toBeTruthy();
    expect(screen.getByText("Geschäftsführung › Bänder")).toBeTruthy();
  });

  it("ASK-AC18: shows space and two heading levels", () => {
    renderAnswer(turn({ sources: [source({ headingPath: ["A", "B"] })] }));
    expect(screen.getByText("Allgemein › A › B")).toBeTruthy();
  });

  it("ASK-AC19: shows only the space name for an empty heading path", () => {
    renderAnswer(turn({}));
    expect(screen.getByText("Allgemein")).toBeTruthy();
  });

  it("ASK-AC20: shows space, file name and page for a PDF", () => {
    renderAnswer(
      turn({
        sources: [
          source({ fileName: "handbuch.pdf", pdfPage: 7, url: "/s/a/p/abc" }),
        ],
      }),
    );
    expect(screen.getByText("Allgemein › handbuch.pdf › Seite 7")).toBeTruthy();
  });

  it("ASK-AC22: links a PDF and an empty-path source to the page top", () => {
    renderAnswer(
      turn({
        answer: "Text.",
        sources: [
          source({ fileName: "handbuch.pdf", pdfPage: 7, url: "/s/a/p/abc" }),
          source({ number: 2, url: "/s/a/p/def" }),
        ],
      }),
    );
    const hrefs = screen
      .getAllByRole("link")
      .map((link) => link.getAttribute("href"));
    expect(hrefs).toEqual(["/s/a/p/abc", "/s/a/p/def"]);
  });

  it("ASK-AC15: lists the sources in number order with their numbers", () => {
    renderAnswer(
      turn({
        answer: "Text.",
        sources: [
          source({ number: 2, title: "Zweite", url: "/s/a/p/two" }),
          source({ number: 1, title: "Erste", url: "/s/a/p/one" }),
        ],
      }),
    );
    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(items[0].textContent).toContain("1");
    expect(items[0].textContent).toContain("Erste");
    expect(items[1].textContent).toContain("2");
    expect(items[1].textContent).toContain("Zweite");
    expect(screen.getByText("Quellen")).toBeTruthy();
  });

  it("ASK-AC25: shows the no-source text instead of the answer", () => {
    renderAnswer(turn({ status: "no_source", answer: "Geheim", sources: [] }));
    expect(screen.getByText(NO_SOURCE_TEXT)).toBeTruthy();
    expect(screen.queryByText("Geheim")).toBeNull();
    expect(screen.queryByText("Quellen")).toBeNull();
  });

  it("ASK-AC36: shows the no-source text for an empty answer", () => {
    renderAnswer(turn({ status: "no_source", answer: "", sources: [] }));
    expect(screen.getByText(NO_SOURCE_TEXT)).toBeTruthy();
    expect(screen.queryByText("Quellen")).toBeNull();
  });

  it("ASK-AC12: keeps the text and adds Abgebrochen without sources", () => {
    renderAnswer(turn({ status: "stopped", answer: "Halber Satz" }));
    expect(screen.getByText("Halber Satz")).toBeTruthy();
    expect(screen.getByText("Abgebrochen")).toBeTruthy();
    expect(screen.queryByText("Quellen")).toBeNull();
  });

  it("ASK-AC69: shows the partial text, then the model error, without sources", () => {
    const { container } = renderAnswer(
      turn({ status: "error", answer: "Anfang", sources: [] }),
    );
    expect(screen.getByText("Anfang")).toBeTruthy();
    expect(screen.getByText(MODEL_ERROR_TEXT)).toBeTruthy();
    const text = container.textContent ?? "";
    expect(text.indexOf("Anfang")).toBeLessThan(text.indexOf(MODEL_ERROR_TEXT));
    expect(screen.queryByText("Quellen")).toBeNull();
  });

  it("ASK-AC67: shows the model error when no text arrived", () => {
    renderAnswer(turn({ status: "error", answer: "", sources: [] }));
    expect(screen.getByText(MODEL_ERROR_TEXT)).toBeTruthy();
    expect(screen.queryByText("Quellen")).toBeNull();
  });

  it("ASK-AC14: shows no sources while streaming", () => {
    renderAnswer(turn({ status: "streaming", answer: "Teil" }));
    expect(screen.getByText("Teil")).toBeTruthy();
    expect(screen.queryByText("Quellen")).toBeNull();
  });
});
