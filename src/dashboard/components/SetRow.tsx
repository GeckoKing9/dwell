import type { ComponentChildren } from 'preact';

interface SetRowProps {
  /** Row id; the title gets `<id>-title` so controls can be labelled by it. */
  id: string;
  title: string;
  desc?: string;
  children?: ComponentChildren;
  /** Full-width content under the row: lists, notices, errors. */
  extra?: ComponentChildren;
}

/** A settings row: what it is and what it does on the left, the control on the right. */
export function SetRow({ id, title, desc, children, extra }: SetRowProps) {
  return (
    <div class="set-row" id={id}>
      <div class="txt">
        <div class="ttl" id={`${id}-title`}>
          {title}
        </div>
        {desc ? <div class="desc">{desc}</div> : null}
      </div>
      {children ? <div class="ctl">{children}</div> : null}
      {extra ?? null}
    </div>
  );
}

/** A status line under a row, read out when it changes. */
export function Notice({ id, text }: { id: string; text: string | undefined }) {
  return text ? (
    <p class="notice" id={id} role="status">
      {text}
    </p>
  ) : null;
}
