import { CHARACTER_LIMIT } from '../constants.js';
import type { ResponseMeta, ResumeData, ResumeSummary } from '../enhancv/client.js';

/** Cut a text at `limit` characters and say so, so the model knows data is missing. */
export function truncateText(text: string, limit: number = CHARACTER_LIMIT): { text: string; truncated: boolean } {
  if (text.length <= limit) return { text, truncated: false };
  return {
    text: `${text.slice(0, limit)}\n\n[Output truncated at ${limit} characters. Request response_format "markdown" for a summary or fetch less data.]`,
    truncated: true
  };
}

/** Warn when the documented per-key rate limit is nearly exhausted. */
export function rateLimitNote(meta: ResponseMeta): string {
  const { remaining, limit, resetAt } = meta.rateLimit;
  if (remaining === undefined || remaining > 5) return '';
  const window = limit === undefined ? '' : ` of ${limit}`;
  const reset = resetAt ? `, resets at ${resetAt}` : '';
  return `\n\nNote: only ${remaining}${window} Enhancv API requests are left in the current rate-limit window${reset}. Avoid further bulk calls.`;
}

const shortDate = (iso?: string): string => (iso ? iso.slice(0, 10) : 'unknown');

export function formatSummaries(resumes: ResumeSummary[]): string {
  return resumes
    .map(resume => {
      const file = resume.filename ? ` - file: ${resume.filename}` : '';
      return `- **${resume.title || 'Untitled'}** (\`${resume.id}\`)${file} - created ${shortDate(resume.createdAt)}, updated ${shortDate(resume.updatedAt)}`;
    })
    .join('\n');
}

const LABEL_FIELDS = ['position', 'workplace', 'degree', 'institution', 'role', 'title', 'name', 'text', 'quote'] as const;

function itemLabel(item: unknown): string {
  if (typeof item !== 'object' || item === null) return '(item)';
  const record = item as Record<string, unknown>;
  const parts = LABEL_FIELDS.map(field => record[field]).filter((value): value is string => typeof value === 'string' && value.length > 0);
  const label = parts.slice(0, 2).join(' @ ');
  return label ? (label.length > 80 ? `${label.slice(0, 77)}...` : label) : '(item)';
}

const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

/** Compact Markdown overview of a resume (not the full content; use response_format "json" for that). */
export function summarizeResume(id: string, resume: ResumeData): string {
  const header = asRecord(resume.header);
  const style = asRecord(resume.style);
  const sections = asRecord(resume.sections);
  const lines = [`# ${typeof resume.title === 'string' && resume.title ? resume.title : 'Untitled resume'} (\`${id}\`)`, ''];
  const contact = ['name', 'title', 'email', 'phone', 'location', 'website']
    .map(field => header[field])
    .filter((value): value is string => typeof value === 'string' && value.length > 0);
  if (contact.length) lines.push(contact.join(' - '), '');
  const styleBits = [
    typeof style.layout === 'string' ? `layout ${style.layout}` : '',
    style.isLetterSize === true ? 'US Letter' : style.isLetterSize === false ? 'A4' : '',
    typeof style.fontHeading === 'string' ? `heading font ${style.fontHeading}` : '',
    typeof style.fontBody === 'string' ? `body font ${style.fontBody}` : ''
  ].filter(Boolean);
  if (styleBits.length) lines.push(`Style: ${styleBits.join(', ')}`, '');
  lines.push('## Sections');
  const entries = Object.entries(sections).sort(([, a], [, b]) => Number(asRecord(a).order ?? 0) - Number(asRecord(b).order ?? 0));
  if (!entries.length) lines.push('(none)');
  for (const [key, value] of entries) {
    const section = asRecord(value);
    const items = Array.isArray(section.items) ? section.items : [];
    const sample = items.slice(0, 3).map(itemLabel).join('; ');
    const name = typeof section.name === 'string' && section.name ? ` "${section.name}"` : '';
    lines.push(`- \`${key}\`${name} (column ${String(section.column ?? '?')}): ${items.length} item(s)${sample ? ` - ${sample}${items.length > 3 ? '; ...' : ''}` : ''}`);
  }
  return lines.join('\n');
}
