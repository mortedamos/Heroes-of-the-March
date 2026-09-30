// Tiny safe DOM builder.
//
// SECURITY: text is only ever set with textContent. There is deliberately no
// way to pass raw HTML, so card text, player names and (later) chat from
// other players can never become markup or script.

type Child = Node | string | number | null | undefined | false;
type Attrs = {
  class?: string;
  title?: string;
  id?: string;
  role?: string;
  type?: string;
  disabled?: boolean;
  tabindex?: number;
  aria?: Record<string, string>;
  data?: Record<string, string>;
  on?: Partial<{ [K in keyof HTMLElementEventMap]: (e: HTMLElementEventMap[K]) => void }>;
  style?: Partial<Record<'left' | 'top' | 'width' | 'height' | 'transform' | 'opacity' | 'display' | '--accent', string>>;
};

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (attrs.class) el.className = attrs.class;
  if (attrs.title) el.title = attrs.title;
  if (attrs.id) el.id = attrs.id;
  if (attrs.role) el.setAttribute('role', attrs.role);
  if (attrs.type) el.setAttribute('type', attrs.type);
  if (attrs.disabled) (el as HTMLButtonElement).disabled = true;
  if (attrs.tabindex !== undefined) el.tabIndex = attrs.tabindex;
  for (const [k, v] of Object.entries(attrs.aria ?? {})) el.setAttribute(`aria-${k}`, v);
  for (const [k, v] of Object.entries(attrs.data ?? {})) el.dataset[k] = v;
  for (const [k, v] of Object.entries(attrs.style ?? {})) if (v !== undefined) el.style.setProperty(k, v);
  for (const [k, fn] of Object.entries(attrs.on ?? {})) if (fn) el.addEventListener(k, fn as EventListener);
  append(el, ...children);
  return el;
}

export function append(el: Node, ...children: Child[]): void {
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    el.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
  }
}

export function clear(el: Element): void {
  while (el.firstChild) el.removeChild(el.firstChild);
}

export function replace(el: Element, ...children: Child[]): void {
  clear(el);
  append(el, ...children);
}
