import type { BlogPostDto } from '@/types/api';

/**
 * Per-tab cache for blog posts, keyed by slug. The list endpoint returns the
 * full post body for each item, so anything cached from the list is enough to
 * render the single page without a fetch.
 *
 * sessionStorage (not localStorage) — scoped to the tab so a sign-out or
 * refresh in another tab doesn't serve stale data here.
 */

const KEY_PREFIX = 'blog:v1:post:';

function key(slug: string): string {
  return `${KEY_PREFIX}${slug}`;
}

export function cachePost(post: BlogPostDto): void {
  try {
    sessionStorage.setItem(key(post.slug), JSON.stringify(post));
  } catch {
    // Quota or disabled storage — silently skip. Cache is opportunistic.
  }
}

export function cachePosts(posts: readonly BlogPostDto[]): void {
  for (const post of posts) cachePost(post);
}

export function getCachedPost(slug: string): BlogPostDto | null {
  try {
    const raw = sessionStorage.getItem(key(slug));
    if (!raw) return null;
    return JSON.parse(raw) as BlogPostDto;
  } catch {
    return null;
  }
}
