// Removes credentials from any text that may reach logs, API errors or the UI.

const URL_CREDENTIALS = /(\b[a-z][a-z0-9+.-]*:\/\/)[^\s/@]+@/gi;
const TOKEN_PATTERNS = [
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g,
  /\bglpat-[A-Za-z0-9_-]{16,}\b/g,
  /\b(authorization:\s*)(basic|bearer)\s+\S+/gi,
  /\b((?:password|passwd|token|secret|api[_-]?key)\s*[=:]\s*)\S+/gi,
];

export function redact(text: string): string {
  let result = text.replace(URL_CREDENTIALS, "$1***@");
  for (const pattern of TOKEN_PATTERNS) {
    result = result.replace(pattern, (_match, prefix) => (typeof prefix === "string" ? `${prefix}***` : "***"));
  }
  return result;
}
