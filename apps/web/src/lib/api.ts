const apiBaseUrl = (import.meta.env.VITE_API_URL ?? 'http://localhost:3333').replace(/\/+$/, '');

export function apiUrl(path: string): string {
  return `${apiBaseUrl}${path.startsWith('/') ? path : `/${path}`}`;
}
