const BANNER_ID = 'app-profile-completion-banner';
const HOST_SELECTOR = '.profile-section .section-wrapper';

export function renderCompletionRing(score: number | null | undefined): void {
  const pct = clampPct(score);
  const host = document.querySelector<HTMLElement>(HOST_SELECTOR);
  if (!host) return;

  let banner = host.querySelector<HTMLElement>(`#${BANNER_ID}`);
  if (!banner) {
    banner = buildBanner();
    host.prepend(banner);
  }

  const fill = banner.querySelector<HTMLElement>('[data-role="fill"]');
  const pctNode = banner.querySelector<HTMLElement>('[data-role="pct"]');
  const tip = banner.querySelector<HTMLElement>('[data-role="tip"]');
  if (fill) fill.style.width = `${pct}%`;
  if (pctNode) pctNode.textContent = `${pct}%`;
  if (tip) tip.textContent = tipFor(pct);
}

function buildBanner(): HTMLElement {
  const banner = document.createElement('div');
  banner.id = BANNER_ID;
  banner.setAttribute('role', 'region');
  banner.setAttribute('aria-label', 'Profile completion');
  Object.assign(banner.style, {
    background: 'linear-gradient(90deg, #2a1219 0%, #1f1418 100%)',
    border: '1px solid #3a1f24',
    borderRadius: '8px',
    padding: '16px 20px',
    marginBottom: '20px',
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
  });

  const head = document.createElement('div');
  Object.assign(head.style, {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: '12px',
    flexWrap: 'wrap',
  });

  const title = document.createElement('div');
  title.innerHTML =
    '<strong style="font-size:15px;color:#fff;">Profile completion</strong>' +
    '<span data-role="tip" style="display:block;font-size:12px;opacity:0.7;margin-top:2px;"></span>';
  head.appendChild(title);

  const pctWrap = document.createElement('div');
  pctWrap.innerHTML =
    '<span data-role="pct" style="font-size:22px;font-weight:700;color:#c2185b;">0%</span>';
  head.appendChild(pctWrap);

  banner.appendChild(head);

  const track = document.createElement('div');
  Object.assign(track.style, {
    height: '8px',
    background: 'rgba(255,255,255,0.08)',
    borderRadius: '999px',
    overflow: 'hidden',
  });

  const fill = document.createElement('div');
  fill.dataset.role = 'fill';
  Object.assign(fill.style, {
    height: '100%',
    width: '0%',
    background: 'linear-gradient(90deg, #c2185b 0%, #ff5083 100%)',
    borderRadius: '999px',
    transition: 'width 450ms ease',
  });
  track.appendChild(fill);
  banner.appendChild(track);

  return banner;
}

function tipFor(pct: number): string {
  if (pct >= 100) return "You're all set — your profile is fully complete.";
  if (pct >= 75) return 'Almost there — a few more details to go.';
  if (pct >= 40)
    return 'Add more info to improve your visibility in search results.';
  return 'Complete your profile to get more matches.';
}

function clampPct(score: number | null | undefined): number {
  if (score === null || score === undefined || !Number.isFinite(score)) return 0;
  return Math.max(0, Math.min(100, Math.round(score)));
}
