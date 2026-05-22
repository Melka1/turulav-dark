/**
 * Generic pagination renderer for the template's `.paginations ul` markup.
 * Used by the members and groups pages (and anywhere else with the same
 * "previous · pages · next" layout).
 */

export type PageInfo = {
  total: number;
  page: number;
  limit: number;
};

export function renderPagination(
  list: HTMLUListElement | null,
  info: PageInfo,
  onJump: (page: number) => void,
): void {
  if (!list) return;
  const totalPages = Math.max(
    1,
    Math.ceil(info.total / Math.max(1, info.limit)),
  );
  if (totalPages <= 1) {
    list.innerHTML = '';
    return;
  }

  const pages = paginationWindow(info.page, totalPages);
  const items: string[] = [];

  items.push(
    pageItem(
      `<i class="icofont-rounded-double-left"></i>`,
      Math.max(1, info.page - 1),
      info.page === 1,
    ),
  );
  for (const p of pages) {
    if (p === 'ellipsis') {
      items.push(`<li><a href="#" data-app-page-disabled="1">...</a></li>`);
    } else {
      items.push(pageItem(String(p), p, false, p === info.page));
    }
  }
  items.push(
    pageItem(
      `<i class="icofont-rounded-double-right"></i>`,
      Math.min(totalPages, info.page + 1),
      info.page === totalPages,
    ),
  );

  list.innerHTML = items.join('');
  list.querySelectorAll<HTMLAnchorElement>('a[data-app-jump]').forEach((a) => {
    a.addEventListener('click', (event) => {
      event.preventDefault();
      const target = Number(a.dataset.appJump);
      if (Number.isFinite(target) && target >= 1) onJump(target);
    });
  });
}

function pageItem(
  label: string,
  page: number,
  disabled: boolean,
  active = false,
): string {
  const attrs = disabled
    ? 'data-app-page-disabled="1" style="opacity:0.4;pointer-events:none;"'
    : `data-app-jump="${page}"`;
  const liClass = active ? ' class="active"' : '';
  return `<li${liClass}><a href="#" ${attrs}>${label}</a></li>`;
}

export function paginationWindow(
  current: number,
  total: number,
): Array<number | 'ellipsis'> {
  if (total <= 7) {
    return Array.from({ length: total }, (_, i) => i + 1);
  }
  const out: Array<number | 'ellipsis'> = [1];
  const start = Math.max(2, current - 1);
  const end = Math.min(total - 1, current + 1);
  if (start > 2) out.push('ellipsis');
  for (let p = start; p <= end; p++) out.push(p);
  if (end < total - 1) out.push('ellipsis');
  out.push(total);
  return out;
}
