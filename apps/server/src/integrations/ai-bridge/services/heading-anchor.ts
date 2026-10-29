import { jsonToMarkdown } from '../../../collaboration/collaboration.util';

const MARKDOWN_HEADING = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/;

const TAB_LABEL_LEVEL = 4;

const LISTS = new Set(['bulletList', 'orderedList']);

const HEADING_CONTAINERS = new Set([
  'callout',
  'details',
  'detailsContent',
  'columns',
  'column',
]);

interface ProseMirrorNode {
  type?: string;
  attrs?: { id?: unknown; level?: unknown };
  content?: ProseMirrorNode[];
}

export function headingAnchor(
  content: unknown,
  headingPath: string[],
): string | undefined {
  if (headingPath.length === 0) return undefined;
  let stack: { level: number; title: string }[] = [];
  const find = (nodes: ProseMirrorNode[]): string | undefined => {
    for (const node of nodes) {
      if (node.type === 'heading') {
        const found = visitHeading(node);
        if (found) return found;
        continue;
      }
      if (node.type && LISTS.has(node.type)) {
        const found = find(indentedHeadings(node));
        if (found) return found;
        continue;
      }
      if (node.type === 'tabs') {
        const found = find(tabParts(node));
        if (found) return found;
        continue;
      }
      if (!node.type || !HEADING_CONTAINERS.has(node.type)) continue;
      const found = find(node.content ?? []);
      if (found) return found;
    }
    return undefined;
  };
  const visitHeading = (node: ProseMirrorNode): string | undefined => {
    const level = Number(node.attrs?.level);
    if (!Number.isInteger(level)) return undefined;
    stack = [
      ...stack.filter((entry) => entry.level < level),
      { level, title: headingTitle(node) },
    ];
    const id = node.attrs?.id;
    return typeof id === 'string' && id && samePath(stack, headingPath)
      ? id
      : undefined;
  };
  return find((content as ProseMirrorNode | null)?.content ?? []);
}

function indentedHeadings(list: ProseMirrorNode): ProseMirrorNode[] {
  return (list.content ?? []).flatMap((item) =>
    (item.content ?? []).slice(1).filter((child) => child.type === 'heading'),
  );
}

function tabParts(tabs: ProseMirrorNode): ProseMirrorNode[] {
  return (tabs.content ?? []).flatMap((tab) =>
    (tab.content ?? []).flatMap((part) => {
      if (part.type === 'tabLabel') {
        return [
          {
            type: 'heading',
            attrs: { level: TAB_LABEL_LEVEL },
            content: part.content,
          },
        ];
      }
      return part.type === 'tabPanel' ? (part.content ?? []) : [];
    }),
  );
}

function headingTitle(node: ProseMirrorNode): string {
  const markdown = jsonToMarkdown({ type: 'doc', content: [node] }).trim();
  return MARKDOWN_HEADING.exec(markdown)?.[2]?.trim() ?? '';
}

function samePath(stack: { title: string }[], headingPath: string[]): boolean {
  return (
    stack.length === headingPath.length &&
    stack.every((entry, index) => entry.title === headingPath[index])
  );
}
