// Small DOM helpers. Screens build elements and set classes; nothing writes a `style` attribute or inline
// markup, because the built page's content security policy allows neither.

type Child = Node | string | null | false | undefined;

type Props = {
  class?: string;
  text?: string;
  attrs?: Record<string, string>;
};

/** Every tag the UI may create. The media tags are left out, so `el` cannot make one (hard rule 2). */
type Tag = Exclude<keyof HTMLElementTagNameMap, 'audio' | 'video' | 'source' | 'track' | 'embed' | 'object' | 'iframe'>;

export const el = <K extends Tag>(
  tag: K,
  props: Props = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  if (props.class !== undefined) node.className = props.class;
  if (props.text !== undefined) node.textContent = props.text;
  for (const [name, value] of Object.entries(props.attrs ?? {})) node.setAttribute(name, value);
  for (const child of children) {
    if (child !== null && child !== false && child !== undefined) node.append(child);
  }
  return node;
};

type ButtonOptions = { class?: string; disabled?: boolean };

/** Every button is at least 44 points tall (see `.btn` in style.css). */
export const button = (label: string, onTap: () => void, options: ButtonOptions = {}): HTMLButtonElement => {
  const node = el('button', { class: `btn ${options.class ?? ''}`.trim(), text: label, attrs: { type: 'button' } });
  node.disabled = options.disabled ?? false;
  node.addEventListener('click', onTap);
  return node;
};

export const section = (title: string, ...children: Child[]): HTMLElement =>
  el('section', { class: 'card' }, el('h2', { text: title }), ...children);

export const line = (label: string, value: string): HTMLElement =>
  el('p', { class: 'line' }, el('span', { class: 'label', text: label }), el('span', { class: 'value', text: value }));

export const formatTime = (at: number): string => {
  const date = new Date(at);
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

/** A commit hash is cut to seven characters, keeping any suffix such as "-dirty". Anything else is shown whole. */
export const shortBuild = (buildId: string): string =>
  /^[0-9a-f]{40}/.test(buildId) ? buildId.slice(0, 7) + buildId.slice(40) : buildId;
