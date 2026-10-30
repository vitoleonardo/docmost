import { createHash } from 'node:crypto';
import { TiptapTransformer } from '@hocuspocus/transformer';
import * as Y from 'yjs';
import { Page } from '@docmost/db/types/entity.types';
import { tiptapExtensions } from '../../../collaboration/collaboration.util';

export interface AgentBlock {
  number: number;
  text: string;
  heading: string | null;
  isHeading: boolean;
  editable: boolean;
}

export interface AgentBlockRead {
  fingerprint: string;
  blocks: AgentBlock[];
}

export interface AgentDiffOp {
  op: 'keep' | 'remove' | 'add';
  text: string;
}

export interface AgentChange {
  block: number;
  oldText: string;
  ops: AgentDiffOp[];
}

export interface AgentChangesInput {
  fingerprint: string;
  changes: AgentChange[];
}

export type AgentApplyResult = 'applied' | 'stale';

type TextAttributes = Record<string, unknown>;

interface DeltaPart {
  insert?: unknown;
  attributes?: TextAttributes;
}

interface LocatedBlock {
  block: AgentBlock;
  element: Y.XmlElement;
}

const TEXT_BLOCK_TYPES = new Set(['paragraph', 'heading']);
const UNREAD_CONTAINER_TYPES = new Set(['codeBlock', 'detailsSummary']);
const OP_KINDS = new Set(['keep', 'remove', 'add']);

export function agentDocumentFingerprint(doc: Y.Doc): string {
  const content = TiptapTransformer.fromYdoc(doc, 'default');
  return createHash('sha256').update(canonicalJson(content)).digest('hex');
}

export function readAgentBlocks(doc: Y.Doc): AgentBlockRead {
  return {
    fingerprint: agentDocumentFingerprint(doc),
    blocks: locateBlocks(doc).map(({ block }) => block),
  };
}

export function storedPageDocument(
  page: Pick<Page, 'ydoc' | 'content'>,
): Y.Doc {
  if (page.ydoc) {
    const doc = new Y.Doc();
    Y.applyUpdate(doc, new Uint8Array(page.ydoc));
    return doc;
  }
  if (page.content) {
    return TiptapTransformer.toYdoc(page.content, 'default', tiptapExtensions);
  }
  return new Y.Doc();
}

export function opsMatchOldText(ops: AgentDiffOp[], oldText: string): boolean {
  const known = ops.every(
    (op) => OP_KINDS.has(op.op) && typeof op.text === 'string',
  );
  const spelled = ops
    .filter((op) => op.op !== 'add')
    .map((op) => op.text)
    .join('');
  return known && spelled === oldText;
}

export function applyAgentChanges(
  doc: Y.Doc,
  input: AgentChangesInput,
): AgentApplyResult {
  if (agentDocumentFingerprint(doc) !== input.fingerprint) return 'stale';
  const located = new Map(
    locateBlocks(doc).map((entry) => [entry.block.number, entry]),
  );
  const targets = input.changes.map((change) => ({
    change,
    target: located.get(change.block),
  }));
  const namedBlocks = new Set(input.changes.map((change) => change.block));
  const applicable =
    namedBlocks.size === input.changes.length &&
    targets.every(({ change, target }) => canApply(target, change));
  if (!applicable) return 'stale';
  targets.forEach(({ change, target }) =>
    applyOps(textSegments(target.element), change.ops),
  );
  return 'applied';
}

function canApply(target: LocatedBlock | undefined, change: AgentChange) {
  return (
    target !== undefined &&
    target.block.editable &&
    target.block.text === change.oldText &&
    opsMatchOldText(change.ops, change.oldText)
  );
}

function locateBlocks(doc: Y.Doc): LocatedBlock[] {
  const located: LocatedBlock[] = [];
  let heading: string | null = null;
  const visit = (node: unknown) => {
    if (!(node instanceof Y.XmlElement)) return;
    if (UNREAD_CONTAINER_TYPES.has(node.nodeName)) return;
    if (!TEXT_BLOCK_TYPES.has(node.nodeName)) {
      node.toArray().forEach(visit);
      return;
    }
    const text = textSegments(node).map(plainText).join('');
    if (!text.trim()) return;
    const isHeading = node.nodeName === 'heading';
    located.push({
      element: node,
      block: {
        number: located.length + 1,
        text,
        heading: isHeading ? null : heading,
        isHeading,
        editable: node.toArray().every((child) => child instanceof Y.XmlText),
      },
    });
    if (isHeading) heading = text;
  };
  doc.getXmlFragment('default').toArray().forEach(visit);
  return located;
}

function textSegments(element: Y.XmlElement): Y.XmlText[] {
  return element
    .toArray()
    .filter((child): child is Y.XmlText => child instanceof Y.XmlText);
}

function deltaOf(segment: Y.XmlText): DeltaPart[] {
  return segment.toDelta();
}

function plainText(segment: Y.XmlText): string {
  return deltaOf(segment)
    .map((part) => (typeof part.insert === 'string' ? part.insert : ''))
    .join('');
}

function applyOps(segments: Y.XmlText[], ops: AgentDiffOp[]) {
  let position = 0;
  let replacedAttributes: TextAttributes | null = null;
  for (const { op, text } of ops) {
    if (op === 'keep') {
      position += text.length;
      replacedAttributes = null;
    } else if (op === 'remove') {
      replacedAttributes ??= attributesAt(segments, position);
      deleteText(segments, position, text.length);
    } else {
      insertText(
        segments,
        position,
        text,
        replacedAttributes ?? attributesBefore(segments, position),
      );
      position += text.length;
      replacedAttributes = null;
    }
  }
}

function segmentAt(
  segments: Y.XmlText[],
  position: number,
  includeEnd: boolean,
): { segment: Y.XmlText; offset: number } {
  let offset = position;
  for (const segment of segments) {
    if (offset < segment.length) return { segment, offset };
    if (includeEnd && offset === segment.length) return { segment, offset };
    offset -= segment.length;
  }
  throw new Error(`Position ${position} is outside the block text`);
}

function attributesAt(segments: Y.XmlText[], index: number): TextAttributes {
  const { segment, offset } = segmentAt(segments, index, false);
  let start = 0;
  for (const part of deltaOf(segment)) {
    const length = typeof part.insert === 'string' ? part.insert.length : 1;
    if (offset < start + length) return { ...part.attributes };
    start += length;
  }
  return {};
}

function attributesBefore(
  segments: Y.XmlText[],
  position: number,
): TextAttributes {
  if (position === 0) return {};
  return Object.fromEntries(
    Object.entries(attributesAt(segments, position - 1)).filter(
      ([name]) => name !== 'link',
    ),
  );
}

function deleteText(segments: Y.XmlText[], position: number, length: number) {
  let remaining = length;
  while (remaining > 0) {
    const { segment, offset } = segmentAt(segments, position, false);
    const count = Math.min(remaining, segment.length - offset);
    segment.delete(offset, count);
    remaining -= count;
  }
}

function insertText(
  segments: Y.XmlText[],
  position: number,
  text: string,
  attributes: TextAttributes,
) {
  const { segment, offset } = segmentAt(segments, position, true);
  segment.insert(offset, text, { ...attributes });
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value) ?? 'null';
  }
  const record = value as Record<string, unknown>;
  const members = Object.keys(record)
    .filter((key) => record[key] !== undefined)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`);
  return `{${members.join(',')}}`;
}
