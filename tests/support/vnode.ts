/**
 * Renders hook-free Preact components in Node by expanding vnodes: no DOM, no extra dependency.
 * Layout and looks are proven by the e2e specs and the 2x screenshots, not here.
 */
export interface El {
  type: string;
  props: Record<string, unknown>;
  ref: unknown;
  children: Tree[];
}
export type Tree = El | string;

/** Expands function components and flattens children into a plain tree. */
export function expand(node: unknown): Tree[] {
  if (node === null || node === undefined || typeof node === 'boolean') return [];
  if (typeof node === 'string' || typeof node === 'number') return [String(node)];
  if (Array.isArray(node)) return node.flatMap(expand);
  const vnode = node as { type: unknown; props: Record<string, unknown>; ref?: unknown };
  if (typeof vnode.type === 'function') return expand((vnode.type as (p: unknown) => unknown)(vnode.props));
  const { children, ...props } = vnode.props;
  return [{ type: String(vnode.type), props, ref: vnode.ref, children: expand(children) }];
}

export function text(trees: Tree[]): string {
  return trees.map((t) => (typeof t === 'string' ? t : text(t.children))).join('');
}

export function all(trees: Tree[], match: (el: El) => boolean): El[] {
  return trees.flatMap((t) => (typeof t === 'string' ? [] : [...(match(t) ? [t] : []), ...all(t.children, match)]));
}

export function byId(trees: Tree[], id: string): El | undefined {
  return all(trees, (el) => el.props.id === id)[0];
}

export function byClass(trees: Tree[], cls: string): El[] {
  return all(trees, (el) => typeof el.props.class === 'string' && el.props.class.split(' ').includes(cls));
}

/** Every rendered text and attribute value, to catch NaN or undefined leaking anywhere. */
export function everything(trees: Tree[]): string {
  return trees
    .map((t) => {
      if (typeof t === 'string') return t;
      const attrs = Object.values(t.props).filter((v) => typeof v !== 'function' && v !== undefined).map(String);
      return `${attrs.join(' ')} ${everything(t.children)}`;
    })
    .join(' ');
}
