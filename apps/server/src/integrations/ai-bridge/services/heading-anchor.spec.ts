import { jsonToMarkdown } from '../../../collaboration/collaboration.util';
import { headingAnchor } from './heading-anchor';

type Json = Record<string, unknown>;

const SECTION_HEADING = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/;

const heading = (level: number, title: string): Json => ({
  type: 'heading',
  attrs: { id: `id-${title}`, level },
  content: [{ type: 'text', text: title }],
});
const paragraph = (text: string): Json => ({
  type: 'paragraph',
  content: [{ type: 'text', text }],
});
const item = (...content: Json[]): Json => ({ type: 'listItem', content });

const SUPPORTED = ['InCallout', 'InDetails', 'InColumn', 'InNestedCallout'];

const DOCUMENT: Json = {
  type: 'doc',
  content: [
    heading(1, 'Top'),
    {
      type: 'callout',
      attrs: { type: 'info' },
      content: [
        heading(2, 'InCallout'),
        {
          type: 'callout',
          attrs: { type: 'info' },
          content: [heading(3, 'InNestedCallout')],
        },
      ],
    },
    {
      type: 'details',
      content: [
        {
          type: 'detailsSummary',
          content: [{ type: 'text', text: 'Mehr' }],
        },
        { type: 'detailsContent', content: [heading(2, 'InDetails')] },
      ],
    },
    {
      type: 'columns',
      content: [
        { type: 'column', content: [heading(2, 'InColumn')] },
        { type: 'column', content: [paragraph('rechts')] },
      ],
    },
    heading(1, 'Unsupported'),
    { type: 'bulletList', content: [item(heading(2, 'FirstInItem'))] },
    {
      type: 'bulletList',
      content: [
        item(paragraph('x'), {
          type: 'bulletList',
          content: [item(heading(2, 'TwoLevelsDeep'))],
        }),
      ],
    },
    {
      type: 'taskList',
      content: [
        {
          type: 'taskItem',
          attrs: { checked: false },
          content: [heading(2, 'InTask')],
        },
      ],
    },
    {
      type: 'table',
      content: [
        {
          type: 'tableRow',
          content: [{ type: 'tableCell', content: [heading(2, 'InCell')] }],
        },
      ],
    },
    {
      type: 'tabs',
      content: [
        {
          type: 'tab',
          content: [
            {
              type: 'tabLabel',
              content: [{ type: 'text', text: 'Reiter' }],
            },
            { type: 'tabPanel', content: [heading(2, 'InTab')] },
          ],
        },
      ],
    },
    { type: 'blockquote', content: [heading(2, 'InQuote')] },
    heading(1, 'After'),
  ],
};

function indexPaths(markdown: string): string[][] {
  const paths: string[][] = [];
  let stack: { level: number; title: string }[] = [];
  for (const line of markdown.split('\n')) {
    const match = SECTION_HEADING.exec(line);
    if (!match) continue;
    const level = match[1].length;
    stack = [
      ...stack.filter((entry) => entry.level < level),
      { level, title: (match[2] ?? '').trim() },
    ];
    paths.push(stack.map((entry) => entry.title));
  }
  return paths;
}

function documentPaths(nodes: Json[]): string[][] {
  const paths: string[][] = [];
  let stack: { level: number; title: string }[] = [];
  const visit = (node: Json) => {
    if (node.type === 'heading') {
      const level = (node.attrs as { level: number }).level;
      const title = ((node.content as Json[])[0].text as string) ?? '';
      stack = [
        ...stack.filter((entry) => entry.level < level),
        { level, title },
      ];
      paths.push(stack.map((entry) => entry.title));
      return;
    }
    ((node.content as Json[] | undefined) ?? []).forEach(visit);
  };
  nodes.forEach(visit);
  return paths;
}

describe('headingAnchor', () => {
  const markdown = jsonToMarkdown(DOCUMENT);
  const produced = indexPaths(markdown);
  const key = (path: string[]) => JSON.stringify(path);
  const producedKeys = new Set(produced.map(key));

  it('ASK-AC21: every supported container keeps its heading at line start in the index', () => {
    for (const title of SUPPORTED) {
      expect(markdown).toMatch(new RegExp(`^#{2,3} ${title}$`, 'm'));
    }
  });

  it('ASK-AC21: a heading path the index produces for a supported container gets that heading id', () => {
    for (const title of SUPPORTED) {
      const path = produced.find(
        (candidate) => candidate[candidate.length - 1] === title,
      )!;
      expect(headingAnchor(DOCUMENT, path)).toBe(`id-${title}`);
    }
  });

  it('ASK-AC21: no path is anchored that the index cannot produce', () => {
    const anchoredButNotProduced = documentPaths(
      DOCUMENT.content as Json[],
    ).filter(
      (path) =>
        headingAnchor(DOCUMENT, path) !== undefined &&
        !producedKeys.has(key(path)),
    );

    expect(anchoredButNotProduced).toEqual([]);
  });

  it.each([
    'FirstInItem',
    'TwoLevelsDeep',
    'InTask',
    'InCell',
    'InTab',
    'InQuote',
  ])('ASK-AC21: a heading in %s gets no anchor', (title) => {
    expect(headingAnchor(DOCUMENT, ['Unsupported', title])).toBeUndefined();
  });
});
