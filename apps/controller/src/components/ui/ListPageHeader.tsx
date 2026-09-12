import type { ReactNode } from "react";
import { HStack } from "@astryxdesign/core/Stack";
import { PageHeader, type PageHeaderProps } from "./PageHeader";

/**
 * A list page's header: its title, stat tiles, an optional summary, filters and search.
 *
 * On a desktop the page looks exactly as it did. The wrapper is `display: contents` there, so the
 * title, the tiles, the summary and the toolbar stay direct children of the page's own stack, in the
 * order they always had, and keep its gaps.
 *
 * On a phone the title, search and filters become one sticky block over the rows that scroll
 * beneath it. The stat tiles are left out: a phone list is for finding a row, and four tiles push
 * the first one off the screen. The summary - an activity strip, a row of status chips - moves to
 * just under the sticky block, where it scrolls away with the rows instead of growing the part of
 * the screen that never moves.
 */
export function ListPageHeader({
  stats,
  summary,
  filters,
  search,
  ...header
}: PageHeaderProps & {
  stats?: ReactNode;
  summary?: ReactNode;
  filters?: ReactNode;
  search?: ReactNode;
}) {
  return (
    <>
      <div className="cpm-list-header">
        <PageHeader {...header} />
        {stats && <div className="cpm-desktop-only">{stats}</div>}
        {summary && <div className="cpm-desktop-only">{summary}</div>}
        {(filters || search) && (
          <HStack
            gap={4}
            vAlign="center"
            wrap="wrap"
            justify="between"
            className="cpm-list-toolbar"
          >
            {filters && <div className="cpm-list-filters">{filters}</div>}
            {search && <div className="cpm-list-search">{search}</div>}
          </HStack>
        )}
      </div>
      {summary && <div className="cpm-mobile-only">{summary}</div>}
    </>
  );
}
