import { TiptapTransformer } from '@hocuspocus/transformer';
import { Document, Hocuspocus } from '@hocuspocus/server';
import { JSONContent } from '@tiptap/core';
import * as Y from 'yjs';
import { tiptapExtensions } from '../../../collaboration/collaboration.util';
import { CollaborationHandler } from '../../../collaboration/collaboration.handler';
import { User } from '@docmost/db/types/entity.types';
import {
  AgentChangesInput,
  AgentDiffOp,
  agentDocumentFingerprint,
  applyAgentChanges,
  opsMatchOldText,
  readAgentBlocks,
} from './agent-document';

type Mark = JSONContent['marks'][number];

const bold: Mark = { type: 'bold' };
const link: Mark = {
  type: 'link',
  attrs: { href: 'https://example.com/form' },
};

function text(value: string, marks?: Mark[]): JSONContent {
  return marks
    ? { type: 'text', text: value, marks }
    : { type: 'text', text: value };
}

function paragraph(...content: (JSONContent | string)[]): JSONContent {
  return {
    type: 'paragraph',
    content: content.map((part) =>
      typeof part === 'string' ? text(part) : part,
    ),
  };
}

function heading(level: number, value: string): JSONContent {
  return { type: 'heading', attrs: { level }, content: [text(value)] };
}

function codeBlock(value: string): JSONContent {
  return { type: 'codeBlock', content: [text(value)] };
}

function emptyParagraph(): JSONContent {
  return { type: 'paragraph' };
}

function bulletList(...items: string[]): JSONContent {
  return {
    type: 'bulletList',
    content: items.map((item) => ({
      type: 'listItem',
      content: [paragraph(item)],
    })),
  };
}

function table(...cells: string[]): JSONContent {
  return {
    type: 'table',
    content: [
      {
        type: 'tableRow',
        content: cells.map((cell) => ({
          type: 'tableCell',
          content: [paragraph(cell)],
        })),
      },
    ],
  };
}

function ydoc(...content: JSONContent[]): Y.Doc {
  return TiptapTransformer.toYdoc(
    { type: 'doc', content },
    'default',
    tiptapExtensions,
  );
}

function contentOf(doc: Y.Doc): JSONContent {
  return TiptapTransformer.fromYdoc(doc, 'default');
}

function blockElement(doc: Y.Doc, ...path: number[]): Y.XmlElement {
  return path.reduce<Y.XmlElement | Y.XmlFragment>(
    (node, index) => node.get(index) as Y.XmlElement,
    doc.getXmlFragment('default'),
  ) as Y.XmlElement;
}

function blockText(doc: Y.Doc, ...path: number[]): Y.XmlText {
  return blockElement(doc, ...path).get(0) as Y.XmlText;
}

function apply(doc: Y.Doc, input: AgentChangesInput) {
  let result: ReturnType<typeof applyAgentChanges>;
  doc.transact(() => {
    result = applyAgentChanges(doc, input);
  });
  return result;
}

function keep(value: string): AgentDiffOp {
  return { op: 'keep', text: value };
}

function remove(value: string): AgentDiffOp {
  return { op: 'remove', text: value };
}

function add(value: string): AgentDiffOp {
  return { op: 'add', text: value };
}

function sixBlockDoc(): Y.Doc {
  return ydoc(
    heading(2, 'Reisekosten'),
    paragraph('Erste Regel gilt.'),
    paragraph('Alte Regel gilt.'),
    paragraph('Vierte ', text('Regel', [bold]), ' gilt.'),
    heading(3, 'Anhang'),
    paragraph('Letzte Regel.'),
  );
}

describe('readAgentBlocks', () => {
  it('AGENT-AC34: numbers heading, paragraph, list items and table cells in document order', () => {
    const doc = ydoc(
      heading(2, 'Reisekosten'),
      paragraph('Die Pauschale beträgt ', text('0,30 €', [bold]), '.'),
      emptyParagraph(),
      codeBlock('const rate = 0.3;'),
      bulletList('Bahn', 'Auto'),
      table('Zelle A', 'Zelle B'),
    );

    expect(readAgentBlocks(doc).blocks).toEqual([
      {
        number: 1,
        text: 'Reisekosten',
        heading: null,
        isHeading: true,
        editable: true,
      },
      {
        number: 2,
        text: 'Die Pauschale beträgt 0,30 €.',
        heading: 'Reisekosten',
        isHeading: false,
        editable: true,
      },
      {
        number: 3,
        text: 'Bahn',
        heading: 'Reisekosten',
        isHeading: false,
        editable: true,
      },
      {
        number: 4,
        text: 'Auto',
        heading: 'Reisekosten',
        isHeading: false,
        editable: true,
      },
      {
        number: 5,
        text: 'Zelle A',
        heading: 'Reisekosten',
        isHeading: false,
        editable: true,
      },
      {
        number: 6,
        text: 'Zelle B',
        heading: 'Reisekosten',
        isHeading: false,
        editable: true,
      },
    ]);
  });

  it('AGENT-AC34: counts toggle content but not its summary', () => {
    const doc = ydoc({
      type: 'details',
      content: [
        { type: 'detailsSummary', content: [text('Mehr lesen')] },
        { type: 'detailsContent', content: [paragraph('Versteckter Text')] },
      ],
    });

    expect(readAgentBlocks(doc).blocks.map((block) => block.text)).toEqual([
      'Versteckter Text',
    ]);
  });

  it('AGENT-AC34: counts paragraphs in task lists, quotes and callouts', () => {
    const doc = ydoc(
      {
        type: 'taskList',
        content: [
          {
            type: 'taskItem',
            attrs: { checked: false },
            content: [paragraph('Aufgabe')],
          },
        ],
      },
      { type: 'blockquote', content: [paragraph('Zitat')] },
      { type: 'callout', content: [paragraph('Hinweis')] },
    );

    expect(readAgentBlocks(doc).blocks.map((block) => block.text)).toEqual([
      'Aufgabe',
      'Zitat',
      'Hinweis',
    ]);
  });

  it('AGENT-AC34: skips whitespace-only paragraphs and headings', () => {
    const doc = ydoc(heading(2, '   '), paragraph(' \t '), paragraph('Text'));

    expect(readAgentBlocks(doc).blocks).toEqual([
      {
        number: 1,
        text: 'Text',
        heading: null,
        isHeading: false,
        editable: true,
      },
    ]);
  });

  it('AGENT-AC34: a block takes the nearest preceding heading as context', () => {
    const blocks = readAgentBlocks(sixBlockDoc()).blocks;

    expect(blocks.map((block) => block.heading)).toEqual([
      null,
      'Reisekosten',
      'Reisekosten',
      'Reisekosten',
      null,
      'Anhang',
    ]);
  });

  it('AGENT-AC117: a page with only a code block and an empty paragraph has no blocks', () => {
    const doc = ydoc(codeBlock('echo hallo'), emptyParagraph());

    expect(readAgentBlocks(doc).blocks).toEqual([]);
  });

  it('AGENT-AC45: a block with a mention is not editable and its text leaves the mention out', () => {
    const doc = ydoc(
      paragraph(
        'Frag ',
        {
          type: 'mention',
          attrs: {
            id: 'mention-1',
            label: 'Max Krüger',
            entityType: 'user',
            entityId: 'user-1',
          },
        },
        ' bei Fragen.',
      ),
      paragraph('Zeile eins', { type: 'hardBreak' }, 'Zeile zwei'),
    );

    expect(readAgentBlocks(doc).blocks).toEqual([
      expect.objectContaining({ text: 'Frag  bei Fragen.', editable: false }),
      expect.objectContaining({
        text: 'Zeile einsZeile zwei',
        editable: false,
      }),
    ]);
  });

  it('AGENT-AC33: an edit made to the live document is in the next read', () => {
    const doc = sixBlockDoc();
    const before = readAgentBlocks(doc);

    blockText(doc, 1).insert(0, 'Neu: ');

    const after = readAgentBlocks(doc);
    expect(after.blocks[1].text).toBe('Neu: Erste Regel gilt.');
    expect(after.fingerprint).not.toBe(before.fingerprint);
  });

  it('AGENT-AC33: reading does not change the document', () => {
    const doc = sixBlockDoc();
    const updates: Uint8Array[] = [];
    doc.on('update', (update: Uint8Array) => updates.push(update));

    doc.transact(() => readAgentBlocks(doc));

    expect(updates).toEqual([]);
  });

  it('AGENT-AC89: the fingerprint is the same for the same content', () => {
    expect(readAgentBlocks(sixBlockDoc()).fingerprint).toBe(
      readAgentBlocks(sixBlockDoc()).fingerprint,
    );
    expect(readAgentBlocks(sixBlockDoc()).fingerprint).toMatch(
      /^[0-9a-f]{64}$/,
    );
  });

  it('AGENT-AC89: the fingerprint does not depend on the order attributes were set in', () => {
    const build = (attributes: [string, number | string][]) => {
      const doc = new Y.Doc();
      const element = new Y.XmlElement('heading');
      attributes.forEach(([key, value]) =>
        element.setAttribute(key, value as string),
      );
      element.insert(0, [new Y.XmlText('Titel')]);
      doc.getXmlFragment('default').insert(0, [element]);
      return doc;
    };

    expect(
      agentDocumentFingerprint(
        build([
          ['level', 2],
          ['indent', 0],
        ]),
      ),
    ).toBe(
      agentDocumentFingerprint(
        build([
          ['indent', 0],
          ['level', 2],
        ]),
      ),
    );
  });
});

describe('opsMatchOldText', () => {
  it('AGENT-AC78: keep and remove runs must spell the old text', () => {
    expect(
      opsMatchOldText([keep('a '), remove('b'), add('c'), keep(' d')], 'a b d'),
    ).toBe(true);
    expect(opsMatchOldText([keep('a '), add('c'), keep(' d')], 'a b d')).toBe(
      false,
    );
    expect(
      opsMatchOldText([keep('a '), remove('b'), keep(' d!')], 'a b d'),
    ).toBe(false);
  });

  it('AGENT-AC78: an unknown op kind does not match', () => {
    expect(
      opsMatchOldText(
        [{ op: 'replace', text: 'a' } as unknown as AgentDiffOp],
        'a',
      ),
    ).toBe(false);
  });
});

describe('applyAgentChanges', () => {
  it('AGENT-AC76: changes block 3 and leaves every other block and attribute as it was', () => {
    const doc = sixBlockDoc();
    const read = readAgentBlocks(doc);
    const expected = structuredClone(contentOf(doc));
    expected.content[2].content = [text('Neue Regel gilt.')];

    const result = apply(doc, {
      fingerprint: read.fingerprint,
      changes: [
        {
          block: 3,
          oldText: 'Alte Regel gilt.',
          ops: [remove('Alte'), add('Neue'), keep(' Regel gilt.')],
        },
      ],
    });

    expect(result).toBe('applied');
    expect(contentOf(doc)).toEqual(expected);
  });

  it('AGENT-AC76: applies several changes in one call', () => {
    const doc = sixBlockDoc();
    const read = readAgentBlocks(doc);

    const result = apply(doc, {
      fingerprint: read.fingerprint,
      changes: [
        {
          block: 2,
          oldText: 'Erste Regel gilt.',
          ops: [keep('Erste Regel '), remove('gilt.'), add('galt.')],
        },
        {
          block: 6,
          oldText: 'Letzte Regel.',
          ops: [remove('Letzte'), add('Schluss'), keep(' Regel.')],
        },
      ],
    });

    expect(result).toBe('applied');
    expect(readAgentBlocks(doc).blocks.map((block) => block.text)).toEqual([
      'Reisekosten',
      'Erste Regel galt.',
      'Alte Regel gilt.',
      'Vierte Regel gilt.',
      'Anhang',
      'Schluss Regel.',
    ]);
  });

  it('AGENT-AC76: applies ops across several text nodes of one block', () => {
    const doc = ydoc(paragraph('Erster Teil'));
    blockElement(doc, 0).insert(1, [new Y.XmlText(' zweiter Teil')]);
    const read = readAgentBlocks(doc);
    expect(read.blocks[0].text).toBe('Erster Teil zweiter Teil');

    const result = apply(doc, {
      fingerprint: read.fingerprint,
      changes: [
        {
          block: 1,
          oldText: 'Erster Teil zweiter Teil',
          ops: [
            keep('Erster '),
            remove('Teil zweiter'),
            add('und'),
            keep(' Teil'),
          ],
        },
      ],
    });

    expect(result).toBe('applied');
    expect(readAgentBlocks(doc).blocks[0].text).toBe('Erster und Teil');
  });

  it('AGENT-AC78: added words that replace bold words are bold', () => {
    const doc = ydoc(
      paragraph(
        'Die Pauschale beträgt ',
        text('0,30 €', [bold]),
        ' pro Kilometer.',
      ),
    );
    const read = readAgentBlocks(doc);

    const result = apply(doc, {
      fingerprint: read.fingerprint,
      changes: [
        {
          block: 1,
          oldText: 'Die Pauschale beträgt 0,30 € pro Kilometer.',
          ops: [
            keep('Die Pauschale beträgt '),
            remove('0,30'),
            add('0,38'),
            keep(' € pro Kilometer.'),
          ],
        },
      ],
    });

    expect(result).toBe('applied');
    expect(contentOf(doc).content[0].content).toEqual([
      text('Die Pauschale beträgt '),
      text('0,38 €', [{ type: 'bold', attrs: {} }]),
      text(' pro Kilometer.'),
    ]);
  });

  it('AGENT-AC78: added words take the formatting of the first removed word they replace', () => {
    const doc = ydoc(
      paragraph(
        'Die Pauschale beträgt ',
        text('0,30 €', [bold]),
        ' pro Kilometer.',
      ),
    );
    const read = readAgentBlocks(doc);

    apply(doc, {
      fingerprint: read.fingerprint,
      changes: [
        {
          block: 1,
          oldText: 'Die Pauschale beträgt 0,30 € pro Kilometer.',
          ops: [
            keep('Die Pauschale beträgt '),
            remove('0,30 € pro'),
            add('0,38 € je'),
            keep(' Kilometer.'),
          ],
        },
      ],
    });

    expect(contentOf(doc).content[0].content).toEqual([
      text('Die Pauschale beträgt '),
      text('0,38 € je', [{ type: 'bold', attrs: {} }]),
      text(' Kilometer.'),
    ]);
  });

  it('AGENT-AC78: added words that replace plain words next to bold ones stay plain', () => {
    const doc = ydoc(paragraph(text('Neu', [bold]), ' alt Text'));
    const read = readAgentBlocks(doc);

    apply(doc, {
      fingerprint: read.fingerprint,
      changes: [
        {
          block: 1,
          oldText: 'Neu alt Text',
          ops: [keep('Neu '), remove('alt'), add('frisch'), keep(' Text')],
        },
      ],
    });

    expect(contentOf(doc).content[0].content).toEqual([
      text('Neu', [{ type: 'bold', attrs: {} }]),
      text(' frisch Text'),
    ]);
  });

  it('AGENT-AC79: a word added after a link carries no link', () => {
    const doc = ydoc(
      paragraph('Bitte das ', text('Formular', [link]), ' ausfüllen.'),
    );
    const read = readAgentBlocks(doc);
    const linkMark = contentOf(doc).content[0].content[1].marks;

    const result = apply(doc, {
      fingerprint: read.fingerprint,
      changes: [
        {
          block: 1,
          oldText: 'Bitte das Formular ausfüllen.',
          ops: [
            keep('Bitte das Formular'),
            add(' online'),
            keep(' ausfüllen.'),
          ],
        },
      ],
    });

    expect(result).toBe('applied');
    expect(contentOf(doc).content[0].content).toEqual([
      text('Bitte das '),
      text('Formular', linkMark),
      text(' online ausfüllen.'),
    ]);
  });

  it('AGENT-AC79: a word added after bold linked text keeps the bold but not the link', () => {
    const doc = ydoc(
      paragraph('Bitte das ', text('Formular', [bold, link]), ' ausfüllen.'),
    );
    const read = readAgentBlocks(doc);

    apply(doc, {
      fingerprint: read.fingerprint,
      changes: [
        {
          block: 1,
          oldText: 'Bitte das Formular ausfüllen.',
          ops: [
            keep('Bitte das Formular'),
            add(' online'),
            keep(' ausfüllen.'),
          ],
        },
      ],
    });

    const parts = contentOf(doc).content[0].content;
    expect(parts.map((part) => part.text)).toEqual([
      'Bitte das ',
      'Formular',
      ' online',
      ' ausfüllen.',
    ]);
    expect(parts[1].marks.map((mark) => mark.type).sort()).toEqual([
      'bold',
      'link',
    ]);
    expect(parts[2].marks).toEqual([{ type: 'bold', attrs: {} }]);
    expect(parts[3].marks).toBeUndefined();
  });

  it('AGENT-AC79: a word added at the start of a block carries no formatting', () => {
    const doc = ydoc(paragraph(text('Neu', [bold]), ' Text'));
    const read = readAgentBlocks(doc);

    apply(doc, {
      fingerprint: read.fingerprint,
      changes: [
        {
          block: 1,
          oldText: 'Neu Text',
          ops: [add('Ganz '), keep('Neu Text')],
        },
      ],
    });

    expect(contentOf(doc).content[0].content).toEqual([
      text('Ganz '),
      text('Neu', [{ type: 'bold', attrs: {} }]),
      text(' Text'),
    ]);
  });

  it('AGENT-AC116: a linked word the diff keeps still carries its link', () => {
    const doc = ydoc(
      paragraph(
        'Bitte das ',
        text('Formular', [link]),
        ' bis Freitag ausfüllen.',
      ),
    );
    const read = readAgentBlocks(doc);
    const before = contentOf(doc).content[0].content;

    const result = apply(doc, {
      fingerprint: read.fingerprint,
      changes: [
        {
          block: 1,
          oldText: 'Bitte das Formular bis Freitag ausfüllen.',
          ops: [
            keep('Bitte das Formular bis '),
            remove('Freitag'),
            add('Montag'),
            keep(' ausfüllen.'),
          ],
        },
      ],
    });

    expect(result).toBe('applied');
    expect(contentOf(doc).content[0].content).toEqual([
      before[0],
      before[1],
      text(' bis Montag ausfüllen.'),
    ]);
  });

  describe('stale', () => {
    const change = {
      block: 3,
      oldText: 'Alte Regel gilt.',
      ops: [remove('Alte'), add('Neue'), keep(' Regel gilt.')],
    };

    function expectStale(doc: Y.Doc, input: AgentChangesInput) {
      const before = contentOf(doc);
      expect(apply(doc, input)).toBe('stale');
      expect(contentOf(doc)).toEqual(before);
    }

    it('AGENT-AC89: a text edit in the changed block since the read makes apply stale', () => {
      const doc = sixBlockDoc();
      const read = readAgentBlocks(doc);

      blockText(doc, 2).insert(0, 'Sehr ');

      expect(readAgentBlocks(doc).fingerprint).not.toBe(read.fingerprint);
      expectStale(doc, { fingerprint: read.fingerprint, changes: [change] });
    });

    it('AGENT-AC89: a changed node attribute since the read makes apply stale', () => {
      const doc = sixBlockDoc();
      const read = readAgentBlocks(doc);

      blockElement(doc, 0).setAttribute('level', 3 as unknown as string);

      expect(readAgentBlocks(doc).fingerprint).not.toBe(read.fingerprint);
      expectStale(doc, { fingerprint: read.fingerprint, changes: [change] });
    });

    it('AGENT-AC91: a text edit in another block since the read makes apply stale', () => {
      const doc = sixBlockDoc();
      const read = readAgentBlocks(doc);

      blockText(doc, 5).insert(0, 'Wirklich ');

      expect(readAgentBlocks(doc).fingerprint).not.toBe(read.fingerprint);
      expectStale(doc, { fingerprint: read.fingerprint, changes: [change] });
    });

    it('AGENT-AC92: bold added to an untouched word since the read makes apply stale', () => {
      const doc = sixBlockDoc();
      const read = readAgentBlocks(doc);

      blockText(doc, 1).format(0, 5, { bold: {} });

      expect(readAgentBlocks(doc).blocks.map((block) => block.text)).toEqual(
        read.blocks.map((block) => block.text),
      );
      expect(readAgentBlocks(doc).fingerprint).not.toBe(read.fingerprint);
      expectStale(doc, { fingerprint: read.fingerprint, changes: [change] });
    });

    it('AGENT-AC93: an edit in a block beyond the first 6,000 characters makes apply stale', () => {
      const long = 'x'.repeat(3000);
      const doc = ydoc(
        paragraph('Alte Regel gilt.'),
        paragraph(long),
        paragraph(long),
        paragraph('Weit hinten.'),
      );
      const read = readAgentBlocks(doc);

      blockText(doc, 3).insert(0, 'Sehr ');

      expect(readAgentBlocks(doc).fingerprint).not.toBe(read.fingerprint);
      expectStale(doc, {
        fingerprint: read.fingerprint,
        changes: [{ ...change, block: 1 }],
      });
    });

    it('AGENT-AC91: an old text that differs from the block makes apply stale', () => {
      const doc = sixBlockDoc();
      const { fingerprint } = readAgentBlocks(doc);

      expectStale(doc, {
        fingerprint,
        changes: [
          {
            block: 3,
            oldText: 'Ganz alte Regel gilt.',
            ops: [remove('Ganz alte'), add('Neue'), keep(' Regel gilt.')],
          },
        ],
      });
    });

    it('AGENT-AC91: ops that do not spell the old text make apply stale', () => {
      const doc = sixBlockDoc();
      const { fingerprint } = readAgentBlocks(doc);

      expectStale(doc, {
        fingerprint,
        changes: [{ ...change, ops: [add('Neue'), keep(' Regel gilt.')] }],
      });
    });

    it('AGENT-AC91: an unknown block number makes apply stale', () => {
      const doc = sixBlockDoc();
      const { fingerprint } = readAgentBlocks(doc);

      expectStale(doc, { fingerprint, changes: [{ ...change, block: 7 }] });
    });

    it('AGENT-AC91: two changes for the same block make apply stale', () => {
      const doc = sixBlockDoc();
      const { fingerprint } = readAgentBlocks(doc);

      expectStale(doc, { fingerprint, changes: [change, change] });
    });

    it('AGENT-AC45: a change to a block with a mention makes apply stale', () => {
      const doc = ydoc(
        paragraph(
          'Frag ',
          {
            type: 'mention',
            attrs: { id: 'mention-1', label: 'Max', entityType: 'user' },
          },
          ' bitte.',
        ),
      );
      const { fingerprint } = readAgentBlocks(doc);

      expectStale(doc, {
        fingerprint,
        changes: [
          {
            block: 1,
            oldText: 'Frag  bitte.',
            ops: [keep('Frag  '), remove('bitte.'), add('heute.')],
          },
        ],
      });
    });

    it('AGENT-AC91: one invalid change writes none of the changes', () => {
      const doc = sixBlockDoc();
      const { fingerprint } = readAgentBlocks(doc);

      expectStale(doc, {
        fingerprint,
        changes: [change, { ...change, block: 6 }],
      });
    });
  });
});

describe('CollaborationHandler agent events', () => {
  const user = { id: 'user-1' } as User;

  function fakeHocuspocus(document: Document) {
    const disconnect = jest.fn(async () => undefined);
    type LiveConnection = Awaited<
      ReturnType<Hocuspocus['openDirectConnection']>
    >;

    const connection: Pick<LiveConnection, 'transact' | 'disconnect'> = {
      transact: async (transaction) => {
        document.transact(() => transaction(document));
      },
      disconnect,
    };
    const openDirectConnection = jest.fn(
      async () => connection as LiveConnection,
    );
    const hocuspocus: Pick<Hocuspocus, 'openDirectConnection'> = {
      openDirectConnection,
    };
    return {
      handlers: new CollaborationHandler().getHandlers(
        hocuspocus as Hocuspocus,
      ),
      openDirectConnection,
      disconnect,
    };
  }

  const documents: Document[] = [];

  afterEach(() => {
    documents.splice(0).forEach((document) => document.destroy());
  });

  function liveDocument(): Document {
    const document = new Document('page.page-1');
    documents.push(document);
    Y.applyUpdate(document, Y.encodeStateAsUpdate(sixBlockDoc()));
    return document;
  }

  it('AGENT-AC33: readAgentBlocks reads the live document through a direct connection', async () => {
    const document = liveDocument();
    const { handlers, openDirectConnection, disconnect } =
      fakeHocuspocus(document);

    const read = await handlers.readAgentBlocks('page.page-1');

    expect(read).toEqual(readAgentBlocks(document));
    expect(read.blocks).toHaveLength(6);
    expect(openDirectConnection).toHaveBeenCalledWith('page.page-1', {});
    expect(disconnect).toHaveBeenCalled();
  });

  it('AGENT-AC76: applyAgentChanges writes with the user as connection context and returns the result', async () => {
    const document = liveDocument();
    const { handlers, openDirectConnection, disconnect } =
      fakeHocuspocus(document);
    const { fingerprint } = readAgentBlocks(document);

    const result = await handlers.applyAgentChanges('page.page-1', {
      fingerprint,
      changes: [
        {
          block: 3,
          oldText: 'Alte Regel gilt.',
          ops: [remove('Alte'), add('Neue'), keep(' Regel gilt.')],
        },
      ],
      user,
    });

    expect(result).toBe('applied');
    expect(readAgentBlocks(document).blocks[2].text).toBe('Neue Regel gilt.');
    expect(openDirectConnection).toHaveBeenCalledWith('page.page-1', { user });
    expect(disconnect).toHaveBeenCalled();
  });

  it('AGENT-AC91: applyAgentChanges returns stale for an old fingerprint', async () => {
    const document = liveDocument();
    const { handlers } = fakeHocuspocus(document);

    const result = await handlers.applyAgentChanges('page.page-1', {
      fingerprint: 'old',
      changes: [],
      user,
    });

    expect(result).toBe('stale');
  });
});
