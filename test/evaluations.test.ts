import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHarness, structured, type Harness } from './helpers/harness.js';

/**
 * Reference solutions for evaluations/questions.xml. Each solver answers its question using only MCP tool calls
 * against the mock Enhancv account, the way an agent would. See evaluations/README.md.
 */

type Qa = { question: string; answer: string };

export function parseEvaluation(xml: string): Qa[] {
  const unescape = (text: string) =>
    text.trim().replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&quot;', '"').replaceAll('&apos;', "'").replaceAll('&amp;', '&');
  return [...xml.matchAll(/<qa_pair>\s*<question>([\s\S]*?)<\/question>\s*<answer>([\s\S]*?)<\/answer>\s*<\/qa_pair>/g)].map(match => ({
    question: unescape(match[1] ?? ''),
    answer: unescape(match[2] ?? '')
  }));
}

type Summary = { id: string; title: string; updatedAt: string };
type Item = Record<string, unknown>;
type Resume = {
  header: { name: string; location?: string };
  sections: Record<string, { items?: Item[] }>;
  style?: { layout?: string; isLetterSize?: boolean; fontHeading?: string };
};

const items = (resume: Resume, section: string): Item[] => resume.sections[section]?.items ?? [];

async function listAll(h: Harness, limit = 100): Promise<Summary[]> {
  const all: Summary[] = [];
  let cursor: string | undefined;
  for (;;) {
    const page = structured<{ resumes: Summary[]; has_more: boolean; next_cursor: string | null }>(
      await h.call('enhancv_list_resumes', { limit, ...(cursor ? { cursor } : {}), response_format: 'json' })
    );
    all.push(...page.resumes);
    if (!page.has_more || !page.next_cursor) return all;
    cursor = page.next_cursor;
  }
}

async function getResume(h: Harness, id: string): Promise<Resume & { title: string }> {
  return structured<{ resume: Resume & { title: string } }>(await h.call('enhancv_get_resume', { resume_id: id })).resume;
}

async function everyResume(h: Harness): Promise<(Resume & { title: string; id: string })[]> {
  const summaries = await listAll(h);
  return Promise.all(summaries.map(async summary => ({ ...(await getResume(h, summary.id)), id: summary.id })));
}

const SOLVERS: ((h: Harness) => Promise<string>)[] = [
  // 1: Lisbon + HashiCorp certificate
  async h => {
    const hit = (await everyResume(h)).find(
      r => r.header.location === 'Lisbon, Portugal' && items(r, 'certificates').some(c => c.issuer === 'HashiCorp')
    );
    return hit?.title ?? '';
  },
  // 2: timeline layout count
  async h => String((await everyResume(h)).filter(r => r.style?.layout === 'timeline').length),
  // 3: most experiences among US Letter resumes
  async h => {
    const letter = (await everyResume(h)).filter(r => r.style?.isLetterSize === true);
    return letter.sort((a, b) => items(b, 'experiences').length - items(a, 'experiences').length)[0]?.title ?? '';
  },
  // 4: PDF file name of the "Architect" resume
  async h => {
    const found = structured<{ matches: { id: string }[] }>(await h.call('enhancv_find_resumes', { query: 'Architect' }));
    const exported = structured<{ filename: string }>(await h.call('enhancv_export_resume_pdf', { resume_id: found.matches[0]!.id }));
    return exported.filename;
  },
  // 5: eighth resume, listed oldest first, with a small page size
  async h => {
    const first = structured<{ next_cursor: string }>(await h.call('enhancv_list_resumes', { limit: 5 }));
    const second = structured<{ resumes: { title: string }[] }>(await h.call('enhancv_list_resumes', { limit: 5, cursor: first.next_cursor }));
    return second.resumes[2]?.title ?? '';
  },
  // 6: person behind the most recently modified resume
  async h => {
    const latest = (await listAll(h)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0]!;
    return (await getResume(h, latest.id)).header.name;
  },
  // 7: Spanish, level text Native
  async h =>
    String((await everyResume(h)).filter(r => items(r, 'languages').some(l => l.name === 'Spanish' && l.levelText === 'Native')).length),
  // 8: ongoing position at Northwind Logistics
  async h => {
    const hit = (await everyResume(h)).find(r =>
      items(r, 'experiences').some(e => e.workplace === 'Northwind Logistics' && (e.dateRange as { isOngoing?: boolean }).isOngoing === true)
    );
    return hit?.header.name ?? '';
  },
  // 9: start month of the Contoso Cloud position; Enhancv months are 0-based
  async h => {
    const found = structured<{ matches: { id: string }[] }>(await h.call('enhancv_find_resumes', { query: 'Platform Engineer - SRE' }));
    const resume = await getResume(h, found.matches[0]!.id);
    const { fromYear, fromMonth } = items(resume, 'experiences').find(e => e.workplace === 'Contoso Cloud')!.dateRange as { fromYear: number; fromMonth: number };
    return `${fromYear}-${String(fromMonth + 1).padStart(2, '0')}`;
  },
  // 10: most skills rated >= 9 among montserrat resumes
  async h => {
    const montserrat = (await everyResume(h)).filter(r => r.style?.fontHeading === 'montserrat');
    const strong = (r: Resume) => items(r, 'industryExperiences').filter(s => Number(s.level) >= 9).length;
    return montserrat.sort((a, b) => strong(b) - strong(a))[0]?.header.name ?? '';
  }
];

const qa = parseEvaluation(readFileSync(new URL('../evaluations/questions.xml', import.meta.url), 'utf8'));

describe('evaluations/questions.xml', () => {
  it('contains exactly ten well-formed, distinct questions with single-line answers', () => {
    expect(qa).toHaveLength(10);
    expect(new Set(qa.map(pair => pair.question)).size).toBe(10);
    for (const pair of qa) {
      expect(pair.question.length).toBeGreaterThan(30);
      expect(pair.answer).not.toBe('');
      expect(pair.answer).not.toContain('\n');
    }
  });

  it('has a reference solution for every question', () => {
    expect(SOLVERS).toHaveLength(qa.length);
  });
});

describe('reference solutions', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await createHarness();
  });
  afterAll(async () => {
    await h.close();
  });

  it.each(qa.map((pair, index) => [index + 1, pair] as const))('question %i is answerable read-only with the MCP tools', async (index, pair) => {
    const before = h.mock.requests.length;
    const answer = await SOLVERS[index - 1]!(h);
    const used = h.mock.requests.slice(before);

    expect(answer, pair.question).toBe(pair.answer);
    expect(used.length, 'the question must require more than one API call').toBeGreaterThanOrEqual(2);
    expect(used.every(request => request.method === 'GET'), 'evaluations must be read-only').toBe(true);
  });
});
