// A small XML string writer (docs/research/FORMATS.md §5.2: no XML builder dependency).
// An element without text and without child elements is left out, so builders can pass optional
// model fields straight through: el('ram:Name', {}, party.name) writes nothing when the name is absent.

export interface XmlElement {
  name: string;
  attrs: Readonly<Record<string, string | undefined>>;
  children: readonly (XmlElement | string)[];
}

export type Child = XmlElement | string | undefined | null | false | readonly Child[];

// XML 1.0 cannot carry these characters at all, not even as references.
// biome-ignore lint/suspicious/noControlCharactersInRegex: the point is to match control characters
const FORBIDDEN = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g;

const escapeText = (s: string) =>
  s.replace(FORBIDDEN, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escapeAttr = (s: string) => escapeText(s).replace(/"/g, '&quot;');

function flatten(children: readonly Child[], out: (XmlElement | string)[]) {
  for (const c of children) {
    if (c === undefined || c === null || c === false) continue;
    if (typeof c === 'string') {
      const text = c.trim();
      if (text !== '') out.push(text);
    } else if ('name' in c) out.push(c);
    else flatten(c as readonly Child[], out);
  }
  return out;
}

/** An element, or undefined when it has no content. */
export function el(
  name: string,
  attrs: Readonly<Record<string, string | undefined>> = {},
  ...children: Child[]
): XmlElement | undefined {
  const content = flatten(children, []);
  if (content.length === 0) return undefined;
  return { name, attrs, children: content };
}

/** An element the schema requires: written even when empty. */
export function req(
  name: string,
  attrs: Readonly<Record<string, string | undefined>> = {},
  ...children: Child[]
): XmlElement {
  return { name, attrs, children: flatten(children, []) };
}

function render(node: XmlElement, depth: number): string {
  const pad = '  '.repeat(depth);
  const attrs = Object.entries(node.attrs)
    .filter((a): a is [string, string] => a[1] !== undefined && a[1].trim() !== '')
    .map(([k, v]) => ` ${k}="${escapeAttr(v.trim())}"`)
    .join('');
  const [first] = node.children;
  if (first === undefined) return `${pad}<${node.name}${attrs}/>`;
  if (node.children.length === 1 && typeof first === 'string') {
    return `${pad}<${node.name}${attrs}>${escapeText(first)}</${node.name}>`;
  }
  const inner = node.children
    .map((c) => (typeof c === 'string' ? `${pad}  ${escapeText(c)}` : render(c, depth + 1)))
    .join('\n');
  return `${pad}<${node.name}${attrs}>\n${inner}\n${pad}</${node.name}>`;
}

/** The document with its XML declaration, indented by 2 spaces, ending with a newline. */
export function serialize(root: XmlElement): string {
  return `<?xml version="1.0" encoding="UTF-8"?>\n${render(root, 0)}\n`;
}
