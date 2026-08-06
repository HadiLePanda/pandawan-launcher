export const AVATAR_IDS = [
  'panda',
  'panda-blue',
  'panda-coral',
  'panda-mint',
  'panda-gold',
] as const;

export type AvatarId = (typeof AVATAR_IDS)[number];

export const DEFAULT_AVATAR_ID: AvatarId = 'panda';

export function avatarUrl(avatarId: string | undefined | null): string {
  const id = AVATAR_IDS.includes(avatarId as AvatarId) ? (avatarId as AvatarId) : DEFAULT_AVATAR_ID;
  return `/avatars/${id}.svg`;
}

const STORAGE_KEY = 'pandawan.avatarId';

export function loadAvatarId(): string {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw && AVATAR_IDS.includes(raw as AvatarId)) {
      return raw;
    }
  } catch {
    // localStorage unavailable — fall through to the default.
  }
  return DEFAULT_AVATAR_ID;
}

export function saveAvatarId(avatarId: string): void {
  const id = AVATAR_IDS.includes(avatarId as AvatarId) ? (avatarId as AvatarId) : DEFAULT_AVATAR_ID;
  try {
    window.localStorage.setItem(STORAGE_KEY, id);
  } catch {
    // Non-persistent preference — swallow write failures.
  }
}
