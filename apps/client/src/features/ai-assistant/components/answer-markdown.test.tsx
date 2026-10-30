import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import AnswerMarkdown from "./answer-markdown.tsx";
import type { IAskSource } from "@/features/ai-assistant/types/ai-assistant.types.ts";

function source(number: number, url: string): IAskSource {
  return {
    number,
    pageId: `p${number}`,
    title: `Seite ${number}`,
    spaceName: "Allgemein",
    headingPath: [],
    fileName: null,
    pdfPage: null,
    url,
  };
}

function renderMarkdown(text: string, sources: IAskSource[] = []) {
  return render(
    <MemoryRouter>
      <AnswerMarkdown text={text} sources={sources} />
    </MemoryRouter>,
  );
}

describe("AnswerMarkdown", () => {
  it("ASK-AC42: renders inline html as literal text", () => {
    const { container } = renderMarkdown("Das ist <b>fett</b> gesagt");
    expect(container.textContent).toContain("<b>fett</b>");
    expect(container.querySelector("b")).toBeNull();
  });

  it("ASK-AC42: renders block html as literal text", () => {
    const { container } = renderMarkdown("<script>alert(1)</script>");
    expect(container.textContent).toContain("<script>alert(1)</script>");
    expect(container.querySelector("script")).toBeNull();
  });

  it("ASK-AC43: renders an image as its alt text without an img element", () => {
    const { container } = renderMarkdown(
      "![Diagramm](https://evil.example/a.png)",
    );
    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toContain("Diagramm");
  });

  it("ASK-AC44: renders a javascript link as text only", () => {
    const { container } = renderMarkdown("[klick](javascript:alert(1))");
    expect(container.querySelector("a")).toBeNull();
    expect(container.textContent).toContain("klick");
  });

  it("ASK-AC44: renders a data link as text only", () => {
    const { container } = renderMarkdown("[d](data:text/html,hallo)");
    expect(container.querySelector("a")).toBeNull();
    expect(container.textContent).toContain("d");
  });

  it("ASK-AC45: opens an https link in a new tab with noopener", () => {
    const { container } = renderMarkdown("[docs](https://example.com)");
    const link = container.querySelector('a[href="https://example.com"]');
    expect(link).not.toBeNull();
    expect(link?.getAttribute("target")).toBe("_blank");
    expect(link?.getAttribute("rel")).toBe("noopener noreferrer");
  });

  it("ASK-AC23: links a citation marker to its source url", () => {
    renderMarkdown("Steht dort [1].", [source(1, "/s/a/p/x#h1")]);
    expect(screen.getByRole("link", { name: "1" }).getAttribute("href")).toBe(
      "/s/a/p/x#h1",
    );
  });

  it("ASK-AC15: links each number of a combined marker to its own source", () => {
    renderMarkdown("Beides [1, 2].", [
      source(1, "/s/a/p/x"),
      source(2, "/s/a/p/y"),
    ]);
    const links = screen.getAllByRole("link");
    expect(links.map((l) => l.getAttribute("href"))).toEqual([
      "/s/a/p/x",
      "/s/a/p/y",
    ]);
  });

  it("ASK-AC23: keeps a marker without a source as text", () => {
    const { container } = renderMarkdown("Offen [3].", [source(1, "/s/a/p/x")]);
    expect(container.querySelector("a")).toBeNull();
    expect(container.textContent).toContain("[3]");
  });

  it.each([
    "[1](https://evil.example)",
    "[[1]](https://evil.example)",
    "[1, 2](https://evil.example)",
  ])("ASK-AC45: renders the citation-looking link %s as plain text", (text) => {
    const { container } = renderMarkdown(text, [source(1, "/s/a/p/x")]);
    expect(container.querySelector("a")).toBeNull();
    expect(container.textContent).toMatch(/1/);
  });

  it("ASK-AC45: keeps an https link whose text is a word", () => {
    const { container } = renderMarkdown("[Handbuch 1](https://example.com)");
    expect(container.querySelector("a")?.getAttribute("href")).toBe(
      "https://example.com",
    );
  });

  it("renders paragraphs, lists, strong and code", () => {
    const { container } = renderMarkdown(
      "**wichtig** und `code`\n\n- eins\n- zwei",
    );
    expect(container.querySelector("strong")?.textContent).toBe("wichtig");
    expect(container.querySelector("code")?.textContent).toBe("code");
    expect(container.querySelectorAll("li")).toHaveLength(2);
  });
});
