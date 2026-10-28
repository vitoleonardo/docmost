import { jsonToMarkdown } from '../../../collaboration/collaboration.util';

const MARKDOWN_HEADING = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/;

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
        const level = Number(node.attrs?.level);
        if (!Number.isInteger(level)) continue;
        stack = [
          ...stack.filter((entry) => entry.level < level),
          { level, title: headingTitle(node) },
        ];
        const id = node.attrs?.id;
        if (typeof id === 'string' && id && samePath(stack, headingPath)) {
          return id;
        }
        continue;
      }
      if (!node.type || !HEADING_CONTAINERS.has(node.type)) continue;
      const found = find(node.content ?? []);
      if (found) return found;
    }
    return undefined;
  };
  return find((content as ProseMirrorNode | null)?.content ?? []);
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
