"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { Plus } from "lucide-react";

/**
 * The phone's floating action button: the one thing you do on a list that is not reading it, in the
 * corner a thumb reaches without leaving the list.
 *
 * Rendered at every width and shown only below the narrow edge by CSS, so the server and the client
 * agree on the markup and nothing flashes in after hydration. On a desktop the page's own button is
 * the action; display: none there also keeps this one out of the accessibility tree, so no width
 * ever offers the same action twice to a screen reader.
 */
export function Fab({
  label,
  icon,
  onClick,
  href,
  isDisabled = false,
}: {
  label: string;
  icon?: ReactNode;
  onClick?: () => void;
  href?: string;
  isDisabled?: boolean;
}) {
  const content = icon ?? <Plus size={24} strokeWidth={2} aria-hidden="true" />;

  if (href && !isDisabled) {
    return (
      <Link href={href} className="cpm-fab" aria-label={label} title={label}>
        {content}
      </Link>
    );
  }

  return (
    <button
      type="button"
      className="cpm-fab"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={isDisabled}
    >
      {content}
    </button>
  );
}
