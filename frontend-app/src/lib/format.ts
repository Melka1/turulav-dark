const EMPTY = '—';

export function notSet(value: string | null | undefined): string {
  return value && value.length > 0 ? value : EMPTY;
}

export function joinList(values: readonly string[] | null): string {
  if (!values || values.length === 0) return EMPTY;
  return values.join(', ');
}

export function titleCase(value: string | null): string {
  if (!value) return EMPTY;
  return value
    .split(/[_\s]+/)
    .map((p) => (p.length ? p[0]!.toUpperCase() + p.slice(1).toLowerCase() : p))
    .join(' ');
}

const GENDER_LABELS: Record<string, string> = {
  male: 'Man',
  female: 'Woman',
  non_binary: 'Non-binary',
  other: 'Other',
  prefer_not_to_say: 'Prefers not to say',
};

export function genderLabel(value: string | null): string {
  if (!value) return EMPTY;
  return GENDER_LABELS[value] ?? titleCase(value);
}

export function genderList(values: readonly string[] | null): string {
  if (!values || values.length === 0) return EMPTY;
  return values.map((v) => GENDER_LABELS[v] ?? titleCase(v)).join(', ');
}

export function calculateAge(dob: string | null): string {
  if (!dob) return EMPTY;
  const birth = new Date(dob);
  if (Number.isNaN(birth.getTime())) return EMPTY;
  const now = new Date();
  let age = now.getFullYear() - birth.getFullYear();
  const m = now.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < birth.getDate())) age -= 1;
  return age >= 0 ? age.toString() : EMPTY;
}

export function formatDate(iso: string | null): string {
  if (!iso) return EMPTY;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return EMPTY;
  return d.toLocaleDateString(undefined, {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

export function formatHeight(cm: number | null): string {
  if (cm == null) return EMPTY;
  return `${cm} cm`;
}

export function formatWeight(kg: number | null): string {
  if (kg == null) return EMPTY;
  return `${kg} kg`;
}

export function formatAddress(
  parts: ReadonlyArray<string | null | undefined>,
): string {
  const filtered = parts.filter((p): p is string => Boolean(p && p.length));
  return filtered.length > 0 ? filtered.join(', ') : EMPTY;
}

const HTML_ESCAPE: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => HTML_ESCAPE[c] ?? c);
}

export function formatRelativeActive(iso: string | null): string {
  if (!iso) return 'Online status unknown';
  const ts = Date.parse(iso);
  if (Number.isNaN(ts)) return 'Online status unknown';
  const diff = Math.max(0, Date.now() - ts);
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return 'Active just now';
  if (minutes < 60)
    return `Active ${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Active ${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.floor(hours / 24);
  return `Active ${days} day${days === 1 ? '' : 's'} ago`;
}
