const TELEGRAM_USERNAME_RE = /^[a-z0-9_]{5,32}$/;

export function parseDisallowedInviterUsernames(value: string): string[] {
  return [...new Set(
    String(value || "")
      .split(/[\s,;]+/)
      .map((item) => item.trim().replace(/^@+/, "").toLowerCase())
      .filter(Boolean),
  )];
}

export function validateDisallowedInviterUsernames(usernames: string[]): boolean {
  return usernames.length > 0
    && usernames.length <= 100
    && findInvalidDisallowedInviterUsernames(usernames).length === 0;
}

export function findInvalidDisallowedInviterUsernames(usernames: string[]): string[] {
  return usernames.filter((username) => !TELEGRAM_USERNAME_RE.test(username));
}
