import { api } from './api';
import type {
  ApiSuccessEnvelope,
  UserMediaItemDto,
  UserMediaListQuery,
  UserMediaListResponseData,
} from '@/types/api';

function buildQueryString(params: Record<string, unknown>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    search.set(key, String(value));
  }
  const qs = search.toString();
  return qs ? `?${qs}` : '';
}

type ListUserMediaArgs = UserMediaListQuery & { userId: string };

export const mediaApi = api.injectEndpoints({
  endpoints: (build) => ({
    listUserMedia: build.query<UserMediaListResponseData, ListUserMediaArgs>({
      query: ({ userId, ...params }) => ({
        url: `/users/${encodeURIComponent(userId)}/media${buildQueryString(params)}`,
      }),
      transformResponse: (response: unknown) =>
        normalizeUserMediaResponse(response),
      providesTags: (_r, _e, arg) => [
        { type: 'UserMedia', id: `${arg.userId}:${arg.kind ?? 'all'}` },
      ],
    }),
  }),
  overrideExisting: false,
});

/**
 * The backend has been seen returning the media list in several shapes —
 * the documented envelope `{ success, data: { items, nextCursor } }`, a bare
 * `{ items, nextCursor }`, a bare array, or an offset-paged
 * `{ items, total, page, limit }`. Normalize to our internal shape so the
 * page binder never has to care.
 */
function normalizeUserMediaResponse(
  raw: unknown,
): UserMediaListResponseData {
  // Peel the success envelope when present.
  let payload: unknown = raw;
  if (isObject(raw) && 'data' in raw && 'success' in raw) {
    payload = (raw as ApiSuccessEnvelope<unknown>).data;
  }
  // Some backends drop the envelope but keep `{ data: [...] }`.
  if (isObject(payload) && Array.isArray((payload as { data?: unknown }).data)) {
    payload = (payload as { data: unknown[] }).data;
  }

  let items: unknown[] = [];
  let nextCursor: string | null = null;

  if (Array.isArray(payload)) {
    items = payload;
  } else if (isObject(payload)) {
    const p = payload as Record<string, unknown>;
    if (Array.isArray(p.items)) items = p.items;
    else if (Array.isArray(p.attachments)) items = p.attachments;
    else if (Array.isArray(p.media)) items = p.media;
    else if (Array.isArray(p.results)) items = p.results;
    if (typeof p.nextCursor === 'string') nextCursor = p.nextCursor;
    else if (typeof p.cursor === 'string') nextCursor = p.cursor;
  }

  // Some shapes wrap each media row inside a parent (e.g. a post with an
  // `attachments[]`). Flatten one level so we end up with the actual media
  // rows.
  items = items.flatMap((entry) => {
    if (isObject(entry) && Array.isArray((entry as { attachments?: unknown }).attachments)) {
      return (entry as { attachments: unknown[] }).attachments;
    }
    return [entry];
  });

  if (items.length === 0 && payload !== undefined && payload !== null) {
    console.warn('[mediaApi] could not find an items[] in response', raw);
  }

  const normalized = items
    .map(normalizeMediaItem)
    .filter((m): m is UserMediaItemDto => m !== null);
  if (items.length > 0 && normalized.length === 0) {
    console.warn(
      '[mediaApi] response had items but none could be normalized — id/url missing?',
      { sample: items[0], raw },
    );
  }
  return { items: normalized, nextCursor };
}

function normalizeMediaItem(raw: unknown): UserMediaItemDto | null {
  if (!isObject(raw)) return null;
  const m = raw as Record<string, unknown>;
  const id = pickString(m, [
    'id',
    'attachmentId',
    'mediaId',
    'media_id',
    'uuid',
  ]);
  const url = pickString(m, ['url', 'mediaUrl', 'fileUrl', 'storageUrl']);
  if (!id || !url) return null;
  const rawKind = pickString(m, ['kind', 'type', 'mediaType']);
  const mime = pickString(m, ['mimeType', 'mime', 'contentType']) ?? '';
  const kind =
    rawKind === 'video' || mime.startsWith('video/') ? 'video' : 'photo';
  return {
    id,
    kind,
    url,
    thumbnailUrl:
      pickString(m, ['thumbnailUrl', 'thumbUrl', 'thumbnail', 'previewUrl']) ?? null,
    width: pickNumber(m, ['width', 'w']),
    height: pickNumber(m, ['height', 'h']),
    durationSeconds: pickNumber(m, ['durationSeconds', 'duration']),
    caption: pickString(m, ['caption', 'description']) ?? null,
    createdAt:
      pickString(m, [
        'createdAt',
        'created_at',
        'uploadedAt',
        'postCreatedAt',
      ]) ?? new Date(0).toISOString(),
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object';
}

function pickString(
  obj: Record<string, unknown>,
  keys: readonly string[],
): string | null {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === 'string' && v.length > 0) return v;
  }
  return null;
}

function pickNumber(
  obj: Record<string, unknown>,
  keys: readonly string[],
): number | null {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === 'number' && Number.isFinite(v)) return v;
  }
  return null;
}
