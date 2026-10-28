import { Fragment, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { marked, type Token, type Tokens } from "marked";
import type { IAskSource } from "@/features/ai-assistant/types/ai-assistant.types.ts";

interface AnswerMarkdownProps {
  text: string;
  sources: IAskSource[];
}

const CITATION_PATTERN = /\[(\d+(?:\s*,\s*\d+)*)\]/g;
const EXTERNAL_PROTOCOLS = ["http:", "https:"];

function isExternalUrl(href: string): boolean {
  try {
    return EXTERNAL_PROTOCOLS.includes(new URL(href).protocol);
  } catch {
    return false;
  }
}

function renderCitations(text: string, sources: IAskSource[]): ReactNode[] {
  const nodes: ReactNode[] = [];
  let cursor = 0;

  for (const match of text.matchAll(CITATION_PATTERN)) {
    const numbers = match[1].split(",").map((part) => Number(part.trim()));
    if (!numbers.every((n) => sources.some((s) => s.number === n))) continue;

    nodes.push(text.slice(cursor, match.index));
    nodes.push("[");
    numbers.forEach((n, index) => {
      const target = sources.find((s) => s.number === n)!;
      if (index > 0) nodes.push(", ");
      nodes.push(
        <Link key={`${match.index}-${n}`} to={target.url}>
          {n}
        </Link>,
      );
    });
    nodes.push("]");
    cursor = match.index + match[0].length;
  }

  nodes.push(text.slice(cursor));
  return nodes;
}

function renderInline(tokens: Token[], sources: IAskSource[]): ReactNode[] {
  return tokens.map((token, index) => {
    switch (token.type) {
      case "text": {
        const textToken = token as Tokens.Text;
        if (textToken.tokens) {
          return (
            <Fragment key={index}>
              {renderInline(textToken.tokens, sources)}
            </Fragment>
          );
        }
        return (
          <Fragment key={index}>
            {renderCitations(textToken.text, sources)}
          </Fragment>
        );
      }
      case "escape":
        return <Fragment key={index}>{(token as Tokens.Escape).text}</Fragment>;
      case "strong":
        return (
          <strong key={index}>
            {renderInline((token as Tokens.Strong).tokens, sources)}
          </strong>
        );
      case "em":
        return (
          <em key={index}>
            {renderInline((token as Tokens.Em).tokens, sources)}
          </em>
        );
      case "del":
        return (
          <del key={index}>
            {renderInline((token as Tokens.Del).tokens, sources)}
          </del>
        );
      case "codespan":
        return <code key={index}>{(token as Tokens.Codespan).text}</code>;
      case "br":
        return <br key={index} />;
      case "link": {
        const link = token as Tokens.Link;
        const children = renderInline(link.tokens, sources);
        if (!isExternalUrl(link.href)) {
          return <Fragment key={index}>{children}</Fragment>;
        }
        return (
          <a
            key={index}
            href={link.href}
            target="_blank"
            rel="noopener noreferrer"
          >
            {children}
          </a>
        );
      }
      case "image":
        return <Fragment key={index}>{(token as Tokens.Image).text}</Fragment>;
      default:
        return <Fragment key={index}>{token.raw}</Fragment>;
    }
  });
}

function renderBlocks(tokens: Token[], sources: IAskSource[]): ReactNode[] {
  return tokens.map((token, index) => {
    switch (token.type) {
      case "space":
        return null;
      case "paragraph":
        return (
          <p key={index}>
            {renderInline((token as Tokens.Paragraph).tokens, sources)}
          </p>
        );
      case "text": {
        const textToken = token as Tokens.Text;
        return (
          <Fragment key={index}>
            {textToken.tokens
              ? renderInline(textToken.tokens, sources)
              : renderCitations(textToken.text, sources)}
          </Fragment>
        );
      }
      case "heading": {
        const heading = token as Tokens.Heading;
        return (
          <p key={index}>
            <strong>{renderInline(heading.tokens, sources)}</strong>
          </p>
        );
      }
      case "list": {
        const list = token as Tokens.List;
        const items = list.items.map((item, itemIndex) => (
          <li key={itemIndex}>{renderBlocks(item.tokens, sources)}</li>
        ));
        return list.ordered ? (
          <ol key={index} start={Number(list.start) || 1}>
            {items}
          </ol>
        ) : (
          <ul key={index}>{items}</ul>
        );
      }
      case "blockquote":
        return (
          <blockquote key={index}>
            {renderBlocks((token as Tokens.Blockquote).tokens, sources)}
          </blockquote>
        );
      case "code":
        return (
          <pre key={index}>
            <code>{(token as Tokens.Code).text}</code>
          </pre>
        );
      case "hr":
        return <hr key={index} />;
      default:
        return <p key={index}>{token.raw}</p>;
    }
  });
}

export default function AnswerMarkdown({ text, sources }: AnswerMarkdownProps) {
  return <>{renderBlocks(marked.lexer(text), sources)}</>;
}
