export const PASSWORD_SALT = "_pgx_sports_lounge_2026_salt!";

export function saltPassword(password: string): string {
  if (!password || password.endsWith(PASSWORD_SALT)) return password;
  return `${password}${PASSWORD_SALT}`;
}
