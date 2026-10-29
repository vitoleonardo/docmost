import { readFileSync } from 'fs';
import { join } from 'path';
import { jsonToMarkdown } from '../../../collaboration/collaboration.util';
import { headingAnchor } from './heading-anchor';

type Json = Record<string, unknown>;

const FIXTURE_PATH = join(
  __dirname,
  '../../../../../../docs/contracts/heading-anchor-fixture.json',
);

const heading = (level: number, title: string): Json => ({
  type: 'heading',
  attrs: { id: `id-${title}`, level },
  content: [{ type: 'text', text: title }],
});
const body = (title: string): Json => paragraph(`Text ${title}`);
const paragraph = (text: string): Json => ({
  type: 'paragraph',
  content: [{ type: 'text', text }],
});
const item = (...content: Json[]): Json => ({ type: 'listItem', content });

const DOCUMENT: Json = {
  type: 'doc',
  content: [
    heading(1, 'Top'),
    body('Top'),
    {
      type: 'callout',
      attrs: { type: 'info' },
      content: [
        heading(2, 'InCallout'),
        body('InCallout'),
        {
          type: 'callout',
          attrs: { type: 'info' },
          content: [heading(3, 'InNestedCallout'), body('InNestedCallout')],
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
        {
          type: 'detailsContent',
          content: [heading(2, 'InDetails'), body('InDetails')],
        },
      ],
    },
    {
      type: 'columns',
      content: [
        {
          type: 'column',
          content: [heading(2, 'InColumn'), body('InColumn')],
        },
        { type: 'column', content: [paragraph('rechts')] },
      ],
    },
    heading(1, 'Unsupported'),
    body('Unsupported'),
    {
      type: 'bulletList',
      content: [
        item(heading(2, 'FirstInItem'), body('FirstInItem')),
        item(
          paragraph('x'),
          heading(2, 'SecondInItem'),
          body('SecondInItem'),
          heading(3, 'ThirdInItem'),
          body('ThirdInItem'),
        ),
      ],
    },
    {
      type: 'orderedList',
      attrs: { start: 1 },
      content: [
        item(paragraph('y'), heading(2, 'SecondInOrderedItem')),
        item(heading(2, 'FirstInOrderedItem')),
      ],
    },
    body('AfterOrdered'),
    {
      type: 'bulletList',
      content: [
        item(paragraph('x'), {
          type: 'bulletList',
          content: [
            item(paragraph('y'), heading(2, 'TwoLevelsDeep'), body('Deep')),
          ],
        }),
      ],
    },
    {
      type: 'taskList',
      content: [
        {
          type: 'taskItem',
          attrs: { checked: false },
          content: [heading(2, 'InTask'), body('InTask')],
        },
      ],
    },
    {
      type: 'table',
      content: [
        {
          type: 'tableRow',
          content: [
            {
              type: 'tableCell',
              content: [heading(2, 'InCell'), body('InCell')],
            },
          ],
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
            {
              type: 'tabPanel',
              content: [heading(2, 'InTab'), body('InTab')],
            },
          ],
        },
      ],
    },
    {
      type: 'blockquote',
      content: [heading(2, 'InQuote'), body('InQuote')],
    },
    heading(1, 'After'),
    body('After'),
  ],
};

interface Fixture {
  markdown: string;
  headings: { id: string; path: string[] }[];
}

const fixture: Fixture = JSON.parse(readFileSync(FIXTURE_PATH, 'utf8'));

describe('headingAnchor', () => {
  it('ASK-AC21: the converter still produces the markdown the index was checked against', () => {
    expect(jsonToMarkdown(DOCUMENT)).toBe(fixture.markdown);
  });

  it('ASK-AC21: every path the index sees as a heading gets that heading id', () => {
    expect(fixture.headings.length).toBeGreaterThan(8);
    for (const { id, path } of fixture.headings) {
      expect(headingAnchor(DOCUMENT, path)).toBe(id);
    }
  });

  it.each([
    'FirstInItem',
    'FirstInOrderedItem',
    'TwoLevelsDeep',
    'InTask',
    'InCell',
    'InQuote',
  ])('ASK-AC21: a heading in %s gets no anchor', (title) => {
    expect(headingAnchor(DOCUMENT, ['Unsupported', title])).toBeUndefined();
    expect(
      fixture.headings.some((entry) => entry.path.includes(title)),
    ).toBe(false);
  });

  it('ASK-AC21: later headings keep their path after a non-first list heading', () => {
    expect(
      headingAnchor(DOCUMENT, ['Unsupported', 'SecondInItem', 'ThirdInItem']),
    ).toBe('id-ThirdInItem');
  });
});
