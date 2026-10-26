export const shortHash = (hash: string) => hash.slice(0, 8);

export function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

const DATE_FORMAT = new Intl.DateTimeFormat(undefined, { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
const SHORT_DATE_FORMAT = new Intl.DateTimeFormat(undefined, { year: "numeric", month: "short", day: "numeric" });

export function formatDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : DATE_FORMAT.format(date);
}

export function formatShortDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : SHORT_DATE_FORMAT.format(date);
}

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 365 * 24 * 3600],
  ["month", 30 * 24 * 3600],
  ["day", 24 * 3600],
  ["hour", 3600],
  ["minute", 60],
];
const RELATIVE_FORMAT = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });

export function relativeTime(iso: string, now = Date.now()): string {
  const seconds = (new Date(iso).getTime() - now) / 1000;
  if (Number.isNaN(seconds)) return iso;
  for (const [unit, size] of UNITS) {
    if (Math.abs(seconds) >= size) return RELATIVE_FORMAT.format(Math.round(seconds / size), unit);
  }
  return "just now";
}

/** Explains ahead/behind counts in words, e.g. for branch comparisons. */
export function describeDivergence(source: string, target: string, ahead: number, behind: number): string {
  if (ahead === 0 && behind === 0) return `${source} and ${target} point at the same commit.`;
  if (behind === 0) return `${source} contains ${plural(ahead, "commit")} that ${ahead === 1 ? "is" : "are"} not in ${target}, and is not missing anything from ${target}.`;
  if (ahead === 0) return `${source} is fully contained in ${target}; ${target} has ${plural(behind, "newer commit")} that ${source} lacks.`;
  return `${source} contains ${plural(ahead, "commit")} that ${ahead === 1 ? "is" : "are"} not in ${target} and is missing ${plural(behind, "commit")} from ${target}.`;
}
