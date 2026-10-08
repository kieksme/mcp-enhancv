import { describe, expect, it } from 'vitest';
import { ICONS } from '../src/enhancv/icons.js';
import { buildIconReference, buildResumeStructureReference, itemFields } from '../src/enhancv/reference.js';
import { LAYOUTS, SECTION_KEYS, createResumeSchema, sectionsSchema } from '../src/enhancv/schemas.js';

/** Condensed copy of the example on https://developers.enhancv.com/api/resume-structure (fictional data). */
const docExample = {
  title: 'Software Engineer Resume',
  header: { name: 'John Doe', title: 'Senior Software Engineer', email: 'john.doe@example.com', phone: '+1 234 567 8900', location: 'San Francisco, CA', website: 'https://johndoe.dev' },
  sections: {
    summaries: { name: 'Professional Summary', column: 0, order: 0, items: [{ text: 'Experienced software engineer.' }] },
    experiences: {
      name: 'Work Experience',
      column: 0,
      order: 1,
      items: [
        {
          workplace: 'Tech Company Inc',
          position: 'Senior Software Engineer',
          location: 'San Francisco, CA',
          dateRange: { fromYear: 2020, fromMonth: 0, toYear: 2024, toMonth: 9, isOngoing: true },
          description: 'Leading microservices development',
          bullets: ['Improved system performance by 60%'],
          link: 'https://example.com',
          companyLogo: 'https://example.com/logo.png'
        }
      ]
    },
    educations: {
      name: 'Education',
      column: 0,
      order: 2,
      items: [{ institution: 'University of California', degree: 'BS in Computer Science', dateRange: { fromYear: 2014, fromMonth: 8, toYear: 2018, toMonth: 4 }, gpa: '3.8', maxGpa: '4.0', gpaText: 'GPA', bullets: ["Dean's List"] }]
    },
    projects: { name: 'Projects', column: 0, order: 3, items: [{ title: 'CI/CD Tool', dateRange: { fromYear: 2023, fromMonth: 0, isOngoing: true }, bullets: ['500+ GitHub stars'], link: 'https://github.com/example' }] },
    volunteering: { name: 'Volunteer Work', column: 0, order: 4, items: [{ institution: 'Code for Good', role: 'Mentor', description: 'Teaching coding' }] },
    publications: { name: 'Publications', column: 0, order: 5, items: [{ title: 'Microservices Best Practices', author: 'John Doe', edition: 'IEEE Vol. 38', dateRange: { fromYear: 2023, fromMonth: 5 }, link: 'https://doi.org/example' }] },
    customs: { name: 'Custom Section', column: 0, order: 6, items: [{ title: 'Tech Blog', icon: '38-free-pencil' }] },
    industryExperiences: { name: 'Skills', column: 1, order: 0, items: [{ name: 'JavaScript', level: 9, icon: '54-free-code' }] },
    skills: { name: 'Technologies', column: 1, order: 1, layoutMode: 'compact', items: [{ title: 'Frontend', description: 'Web development', tags: ['React', 'TypeScript'] }] },
    languages: { name: 'Languages', column: 1, order: 2, items: [{ name: 'English', level: 5, levelText: 'Native' }] },
    certificates: { name: 'Certifications', column: 1, order: 3, items: [{ title: 'AWS Solutions Architect', issuer: 'Amazon Web Services' }] },
    courses: { name: 'Courses', column: 1, order: 4, items: [{ title: 'System Design', description: 'Advanced course' }] },
    achievements: { name: 'Achievements', column: 1, order: 5, items: [{ title: 'Hackathon Winner', icon: '83-free-prize-award' }] },
    awards: { name: 'Awards', column: 1, order: 6, items: [{ title: 'Employee of the Year', icon: '80-medal-01' }] },
    interests: { name: 'Interests', column: 1, order: 7, items: [{ title: 'Photography', icon: '99-free-camera' }] },
    strengths: { name: 'Strengths', column: 1, order: 8, items: [{ title: 'Problem Solving', icon: '148-brain-01' }] },
    findMeOnline: { name: 'Online Profiles', column: 1, order: 9, items: [{ title: 'GitHub', link: 'https://github.com/johndoe', icon: 'github' }] },
    books: { name: 'Reading List', column: 1, order: 10, items: [{ title: 'Clean Code', author: 'Robert Martin', image: 'https://example.com/book.jpg' }] },
    quotes: { name: 'Quotes', column: 1, order: 11, items: [{ quote: 'Code is poetry', author: 'Anonymous' }] },
    references: { name: 'References', column: 1, order: 12, items: [{ name: 'Jane Smith', contact: 'jane@example.com' }] },
    mytime: { name: 'Time Allocation', column: 1, order: 13, items: [{ pieces: 24, data: [{ title: 'Coding', value: 8 }, { title: 'Sleep', value: 7 }] }] }
  },
  style: { layout: 'double', colors: ['#000000', '#008CFF'], fontBody: 'opensans', fontHeading: 'montserrat', fontSize: 2, hideBranding: false, isLetterSize: true, marginOption: 2, pageMarginOption: 3, columnLayoutOption: 1, lineHeightOption: 1, headerExtraSpacing: 0 }
};

const minimal = (sections: Record<string, unknown>, style?: Record<string, unknown>) => ({ header: { name: 'A' }, sections, ...(style ? { style } : {}) });
const messages = (input: unknown) => {
  const result = createResumeSchema.safeParse(input);
  return result.success ? [] : result.error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`);
};

describe('createResumeSchema', () => {
  it('accepts the complete example from the documentation', () => {
    expect(messages(docExample)).toEqual([]);
  });

  it('accepts the retrieve response and keeps the retrieve -> create round trip valid', () => {
    const retrieved = {
      header: { name: 'John Doe', title: 'Senior Software Engineer', email: 'john@example.com', phone: '+1 234 567 8900', location: 'San Francisco, CA' },
      sections: { industryExperiences: { name: 'Skills', column: 1, order: 2, items: [{ name: 'JavaScript', level: 5 }] } },
      title: 'Software Engineer Resume',
      style: { layout: 'double', colors: ['#000000', '#008CFF'] }
    };
    expect(messages(retrieved)).toEqual([]);
  });

  it('requires header and sections', () => {
    expect(messages({ sections: {} })).not.toEqual([]);
    expect(messages({ header: {} })).not.toEqual([]);
    expect(messages({ header: {}, sections: {} })).toEqual([]);
  });

  it('requires a column for every section and limits it to 0-2', () => {
    expect(messages(minimal({ summaries: { items: [{ text: 'x' }] } }))).not.toEqual([]);
    expect(messages(minimal({ summaries: { column: 3, items: [] } }))).not.toEqual([]);
  });

  it('allows the third column only with the multicolumn layout', () => {
    const third = { summaries: { column: 2, items: [{ text: 'x' }] } };
    expect(messages(minimal(third, { layout: 'double' })).join()).toContain('multicolumn');
    expect(messages(minimal(third))).not.toEqual([]);
    expect(messages(minimal(third, { layout: 'multicolumn' }))).toEqual([]);
  });

  it('enforces the documented value ranges', () => {
    const item = (items: unknown[], key = 'experiences') => minimal({ [key]: { column: 0, items } });
    expect(messages(item([{ dateRange: { fromYear: 2020, fromMonth: 12 } }]))).not.toEqual([]);
    expect(messages(item([{ dateRange: { fromYear: 2020, fromMonth: -1 } }]))).not.toEqual([]);
    expect(messages(item([{ dateRange: { fromYear: 2020, fromMonth: 0, isOngoing: true } }]))).toEqual([]);
    expect(messages(item([{ name: 'JS', level: 10 }], 'industryExperiences'))).toEqual([]);
    expect(messages(item([{ name: 'JS', level: 11 }], 'industryExperiences'))).not.toEqual([]);
    expect(messages(item([{ name: 'EN', level: 5 }], 'languages'))).toEqual([]);
    expect(messages(item([{ name: 'EN', level: 6 }], 'languages'))).not.toEqual([]);
  });

  it('rejects unknown sections, fields and style values', () => {
    expect(messages(minimal({ hobbies: { column: 0 } }))).not.toEqual([]);
    expect(messages(minimal({ experiences: { column: 0, items: [{ company: 'x' }] } }))).not.toEqual([]);
    expect(messages(minimal({}, { layout: 'fancy' }))).not.toEqual([]);
    expect(messages(minimal({}, { fontBody: 'comicsans' }))).not.toEqual([]);
    expect(messages(minimal({}, { fontSize: 5 }))).not.toEqual([]);
    expect(messages(minimal({}, { colors: ['red'] }))).not.toEqual([]);
    expect(messages(minimal({}, { colors: ['#000', '#111111', '#222222'] }))).not.toEqual([]);
  });

  it('validates icons against the documented list and suggests alternatives', () => {
    const withIcon = (icon: string) => minimal({ awards: { column: 1, items: [{ title: 'x', icon }] } });
    expect(messages(withIcon('80-medal-01'))).toEqual([]);
    const issue = messages(withIcon('medal')).join();
    expect(issue).toContain('Unknown icon "medal"');
    expect(issue).toContain('80-medal-01');
  });

  it('rejects script URL schemes in links', () => {
    const link = (value: string) => minimal({ projects: { column: 0, items: [{ title: 'x', link: value }] } });
    expect(messages(link('https://example.com'))).toEqual([]);
    expect(messages(link('javascript:alert(1)'))).not.toEqual([]);
    expect(messages(link(' data:text/html;base64,AAAA'))).not.toEqual([]);
  });

  it('accepts skills layout hints only on skills-like sections', () => {
    expect(messages(minimal({ skills: { column: 1, layoutMode: 'bullets', showBulletMarker: false, items: [] } }))).toEqual([]);
    expect(messages(minimal({ skills: { column: 1, layoutMode: 'grid' } }))).not.toEqual([]);
    expect(messages(minimal({ experiences: { column: 0, layoutMode: 'tags' } }))).not.toEqual([]);
  });
});

describe('reference data', () => {
  it('lists exactly the documented section keys, 26 of them', () => {
    expect([...SECTION_KEYS].sort()).toEqual(Object.keys(sectionsSchema.shape).sort());
    expect(SECTION_KEYS).toHaveLength(26);
  });

  it('derives the documentation from the schemas so it cannot drift', () => {
    const markdown = buildResumeStructureReference();
    for (const key of SECTION_KEYS) expect(markdown).toContain(`| \`${key}\` |`);
    for (const [id, name] of Object.entries(LAYOUTS)) expect(markdown).toContain(`| \`${id}\` | ${name} |`);
    expect(itemFields('experiences')).toContain('workplace');
    expect(itemFields('languages')).toEqual(['name', 'level', 'levelText']);
    expect(markdown).toContain('Months are 0-based');
  });

  it('contains every documented icon exactly once (230 identifiers)', () => {
    expect(ICONS).toHaveLength(230);
    expect(new Set(ICONS).size).toBe(230);
    const markdown = buildIconReference();
    expect(markdown).toContain('- 001-free-plus');
    expect(markdown).toContain('- youtube-square');
  });
});
