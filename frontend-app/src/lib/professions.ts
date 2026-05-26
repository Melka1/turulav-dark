/**
 * Canonical list of professions used by the profile-edit dropdown and (later)
 * the home page banner filter. Wire format is the UPPER_SNAKE_CASE key; the
 * label is for display only. `OTHER` is a sentinel — when chosen, the UI
 * prompts the user for a free-form string and that string is stored verbatim
 * in `profile.profession` (so the read-only renderer should fall back to the
 * raw value when it doesn't match a known key).
 */

export type ProfessionOption = { key: string; label: string };

export const PROFESSIONS: ReadonlyArray<ProfessionOption> = [
  { key: 'PAINTER', label: 'Painter' },
  { key: 'PHOTOGRAPHER', label: 'Photographer' },
  { key: 'MODEL', label: 'Model' },
  { key: 'PROJECT_MANAGER', label: 'Project Manager' },
  { key: 'DEVELOPER', label: 'Developer' },
  { key: 'MUSICIAN', label: 'Musician' },
  { key: 'SINGER', label: 'Singer' },
  { key: 'PRODUCER', label: 'Producer' },
  { key: 'DIRECTOR', label: 'Director' },
  { key: 'RAPPER', label: 'Rapper' },
  { key: 'VIDEOGRAPHER', label: 'Videographer' },
  { key: 'EDITOR_WRITING', label: 'Editor (Writing)' },
  { key: 'EDITOR_VIDEO', label: 'Editor (Video)' },
  { key: 'GRAPHIC_DESIGNER', label: 'Graphic Designer' },
  { key: 'WEB_DEVELOPER', label: 'Web Developer' },
  { key: 'VENUE', label: 'Venue' },
  { key: 'SEAMSTRESS', label: 'Seamstress' },
  { key: 'ACTOR_ACTRESS', label: 'Actor/Actress' },
  { key: 'MAKEUP_ARTIST', label: 'Makeup Artist' },
  { key: 'INTERIOR_DECORATOR', label: 'Interior Decorator' },
  { key: 'CATERER', label: 'Caterer' },
  { key: 'PROMOTER', label: 'Promoter' },
  { key: 'PRINTER', label: 'Printer' },
  { key: 'DANCER', label: 'Dancer' },
  { key: 'ARCHITECT', label: 'Architect' },
  { key: 'ENGINEER', label: 'Engineer' },
  { key: 'CONTRACTOR', label: 'Contractor' },
  { key: 'WRITER', label: 'Writer' },
  { key: 'STYLIST', label: 'Stylist' },
  { key: 'VOICEOVER_ARTIST', label: 'Voiceover Artist' },
  { key: 'SONGWRITER', label: 'Songwriter' },
];

export const PROFESSION_OTHER_KEY = 'OTHER';

export const PROFESSION_LABEL_BY_KEY: Record<string, string> = {
  ...Object.fromEntries(PROFESSIONS.map((p) => [p.key, p.label])),
  [PROFESSION_OTHER_KEY]: 'Other',
};

export function isKnownProfessionKey(value: string): boolean {
  return value in PROFESSION_LABEL_BY_KEY;
}

export function formatProfession(value: string | null | undefined): string | null {
  if (!value) return null;
  return PROFESSION_LABEL_BY_KEY[value] ?? value;
}
