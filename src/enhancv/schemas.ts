/**
 * Zod schemas for the Enhancv resume structure.
 *
 * Source of truth: https://developers.enhancv.com/api/resume-structure and
 * https://developers.enhancv.com/api/create. Every value list and range below is
 * copied from there. The API behaviour for undocumented values is unspecified, so the
 * schemas are deliberately strict; update the constants when Enhancv extends them.
 */
import * as z from 'zod/v4';
import { isKnownIcon, suggestIcons } from './icons.js';

// --- Enumerations (documented) -------------------------------------------------------

/** `style.layout` API value -> template name shown in the Enhancv editor. */
export const LAYOUTS = {
  double: 'Double Column',
  ivyleague: 'Ivy League',
  elegant: 'Elegant',
  newcondensed: 'Modern',
  polished: 'Polished',
  stockholm: 'Contemporary',
  double_colored: 'Creative',
  timeline: 'Timeline',
  flipped_modern: 'Stylish',
  single: 'Single Column',
  condensed: 'Compact',
  multicolumn: 'Multicolumn',
  classic: 'Classic',
  high_performer: 'High Performer',
  minimal: 'Minimal'
} as const;
export type LayoutId = keyof typeof LAYOUTS;
export const LAYOUT_IDS = Object.keys(LAYOUTS) as [LayoutId, ...LayoutId[]];

export const BODY_FONTS = ['opensans', 'roboto', 'ptsans', 'interui'] as const;

export const HEADING_FONTS = [
  'rubik', 'arimo', 'lato', 'raleway', 'bitter', 'exo', 'exolocked', 'chivo', 'chivolocked',
  'montserrat', 'tinos', 'montserratlocked', 'oswald', 'oswaldlocked', 'volkhov', 'robotoslab',
  'playfair', 'abril', 'gelasio'
] as const;

/** All section keys of the `sections` object (`customs2`/`customs3` share the `customs` item schema). */
export const SECTION_KEYS = [
  'summaries', 'experiences', 'educations', 'projects', 'volunteering', 'publications',
  'customs', 'customs2', 'customs3', 'industryExperiences', 'skills', 'languages', 'certificates',
  'courses', 'achievements', 'awards', 'interests', 'strengths', 'findMeOnline', 'books', 'quotes',
  'references', 'mytime', 'additionalExperiences', 'additionalPublications', 'additionalTechnologies'
] as const;
export type SectionKey = (typeof SECTION_KEYS)[number];

// --- Building blocks -----------------------------------------------------------------

/** Register a schema under an id so the JSON Schema sent to clients references it via $defs instead of repeating it. */
const named = <T extends z.ZodType>(id: string, schema: T): T => schema.meta({ id });

const SHORT = 500;
const LONG = 10_000;

const str = (max: number = SHORT) => z.string().max(max);

/** URL-ish string. Dangerous script schemes are rejected because the value ends up as a link in the resume. */
const link = () =>
  z.string().max(2048).refine(value => !/^\s*(?:javascript|data|vbscript):/i.test(value), {
    message: 'URL scheme is not allowed (javascript:, data: and vbscript: are rejected).'
  });

const iconSchema = named('Icon', z.string().max(64).superRefine((value, ctx) => {
    if (isKnownIcon(value)) return;
    const suggestions = suggestIcons(value);
    ctx.addIssue({
      code: 'custom',
      message: `Unknown icon "${value}".${suggestions.length ? ` Did you mean: ${suggestions.join(', ')}?` : ''} See the enhancv://reference/icons resource for all valid icon identifiers.`
    });
  }).describe('Icon identifier from the enhancv://reference/icons resource, e.g. "54-free-code"'));
const icon = () => iconSchema;

const bullets = () => z.array(str(LONG)).max(50).describe('Bullet points');

const hexColor = z.string().regex(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, 'Use a hex color such as "#008CFF"');

export const dateRangeSchema = named('DateRange', z
  .object({
    fromYear: z.number().int().optional().describe('Start year, e.g. 2020'),
    fromMonth: z.number().int().min(0).max(11).optional().describe('Start month 0-11 (0 = January, 11 = December)'),
    toYear: z.number().int().optional().describe('End year; omit when isOngoing is true'),
    toMonth: z.number().int().min(0).max(11).optional().describe('End month 0-11 (0 = January); omit when isOngoing is true'),
    isOngoing: z.boolean().optional().describe('True for a current position/period')
  })
  .strict());

// --- Item schemas (all item fields are optional in the API) --------------------------

const experienceItem = z
  .object({
    workplace: str().optional().describe('Company name'),
    position: str().optional().describe('Job title'),
    location: str().optional(),
    dateRange: dateRangeSchema.optional(),
    description: str(LONG).optional(),
    bullets: bullets().optional(),
    link: link().optional().describe('Company website'),
    companyLogo: link().optional().describe('Company logo URL')
  })
  .strict();

const educationItem = z
  .object({
    institution: str().optional(),
    degree: str().optional(),
    location: str().optional(),
    dateRange: dateRangeSchema.optional(),
    gpa: str(20).optional().describe('GPA value as string, e.g. "3.8"'),
    maxGpa: str(20).optional().describe('Maximum GPA as string, e.g. "4.0"'),
    gpaText: str(50).optional().describe('GPA label text'),
    bullets: bullets().optional(),
    companyLogo: link().optional().describe('Institution logo URL')
  })
  .strict();

const skillLevelItem = z
  .object({
    name: str().optional().describe('Skill name'),
    level: z.number().int().min(0).max(10).optional().describe('Proficiency 0-10'),
    icon: icon().optional()
  })
  .strict();

const summaryItem = z.object({ text: str(LONG).optional() }).strict();

const volunteeringItem = z
  .object({
    institution: str().optional().describe('Organization name'),
    role: str().optional(),
    location: str().optional(),
    dateRange: dateRangeSchema.optional(),
    description: str(LONG).optional(),
    bullets: bullets().optional(),
    companyLogo: link().optional().describe('Organization logo URL')
  })
  .strict();

const publicationItem = z
  .object({
    title: str().optional(),
    author: str().optional(),
    edition: str().optional().describe('Edition/volume'),
    dateRange: dateRangeSchema.optional(),
    description: str(LONG).optional(),
    link: link().optional()
  })
  .strict();

const projectItem = z
  .object({
    title: str().optional(),
    location: str().optional(),
    dateRange: dateRangeSchema.optional(),
    description: str(LONG).optional(),
    bullets: bullets().optional(),
    link: link().optional()
  })
  .strict();

const customItem = z
  .object({
    title: str().optional(),
    description: str(LONG).optional(),
    dateRange: dateRangeSchema.optional(),
    icon: icon().optional()
  })
  .strict();

const titleDescriptionIconItem = z
  .object({ title: str().optional(), description: str(LONG).optional(), icon: icon().optional() })
  .strict();

const bookItem = z.object({ title: str().optional(), author: str().optional(), image: link().optional().describe('Cover image URL') }).strict();
const certificateItem = z.object({ title: str().optional(), issuer: str().optional() }).strict();
const courseItem = z.object({ title: str().optional(), description: str(LONG).optional() }).strict();

const languageItem = z
  .object({
    name: str().optional(),
    level: z.number().int().min(0).max(5).optional().describe('Proficiency 0-5'),
    levelText: str(50).optional().describe('Level label, e.g. "Native", "Fluent"')
  })
  .strict();

const quoteItem = z.object({ quote: str(LONG).optional(), author: str().optional() }).strict();
const referenceItem = z.object({ name: str().optional(), contact: str().optional() }).strict();
const findMeOnlineItem = z.object({ title: str().optional().describe('Platform name'), link: link().optional(), icon: icon().optional() }).strict();

const skillsItem = z
  .object({
    title: str().optional().describe('Technology category'),
    description: str(LONG).optional(),
    tags: z.array(str(100)).max(100).optional().describe('List of technologies')
  })
  .strict();

const mytimeItem = z
  .object({
    pieces: z.number().int().min(0).optional().describe('Total number of time pieces'),
    data: z.array(z.object({ title: str(100), value: z.number() }).strict()).max(50).optional()
  })
  .strict();

// --- Sections ------------------------------------------------------------------------

const columnSchema = named(
  'Column',
  z
    .number()
    .int()
    .min(0)
    .max(2)
    .describe('Column placement (required): 0 = left, 1 = right, 2 = third column (only with style.layout "multicolumn")')
);

const sectionShape = <T extends z.ZodType>(item: T) => ({
  column: columnSchema,
  order: z.number().int().min(0).optional().describe('Display order, lower first; insertion order if omitted'),
  name: str(200).optional().describe('Section heading'),
  items: z.array(item).max(200).optional()
});

const section = <T extends z.ZodType>(id: string, item: T) => named(id, z.object(sectionShape(item)).strict());

/** Skills-style sections additionally accept layout hints. */
const skillsSection = <T extends z.ZodType>(id: string, item: T) =>
  named(
    id,
    z
      .object({
        ...sectionShape(item),
        layoutMode: z.enum(['tags', 'compact', 'bullets']).optional().describe('"tags" (default), "compact" or "bullets"'),
        showBulletMarker: z.boolean().optional().describe('Only used with layoutMode "bullets" (default true)')
      })
      .strict()
  );

// Sections that share an item schema share one named definition in the JSON Schema sent to clients.
const experienceSection = section('ExperienceSection', experienceItem);
const publicationSection = section('PublicationSection', publicationItem);
const customSection = section('CustomSection', customItem);
const iconTextSection = section('IconTextSection', titleDescriptionIconItem);
const technologiesSection = skillsSection('TechnologiesSection', skillsItem);

export const sectionsSchema = z
  .object({
    summaries: section('SummarySection', summaryItem).optional(),
    experiences: experienceSection.optional(),
    educations: section('EducationSection', educationItem).optional(),
    projects: section('ProjectSection', projectItem).optional(),
    volunteering: section('VolunteeringSection', volunteeringItem).optional(),
    publications: publicationSection.optional(),
    customs: customSection.optional(),
    customs2: customSection.optional(),
    customs3: customSection.optional(),
    industryExperiences: section('SkillLevelSection', skillLevelItem).optional(),
    skills: technologiesSection.optional(),
    languages: section('LanguageSection', languageItem).optional(),
    certificates: section('CertificateSection', certificateItem).optional(),
    courses: section('CourseSection', courseItem).optional(),
    achievements: iconTextSection.optional(),
    awards: iconTextSection.optional(),
    interests: iconTextSection.optional(),
    strengths: iconTextSection.optional(),
    findMeOnline: section('FindMeOnlineSection', findMeOnlineItem).optional(),
    books: section('BookSection', bookItem).optional(),
    quotes: section('QuoteSection', quoteItem).optional(),
    references: section('ReferenceSection', referenceItem).optional(),
    mytime: section('MyTimeSection', mytimeItem).optional(),
    additionalExperiences: experienceSection.optional(),
    additionalPublications: publicationSection.optional(),
    additionalTechnologies: technologiesSection.optional()
  })
  .strict();

export const headerSchema = z
  .object({
    name: str().optional().describe('Full name'),
    title: str().optional().describe('Professional title'),
    email: str().optional(),
    phone: str().optional(),
    location: str().optional(),
    website: link().optional()
  })
  .strict();

export const styleSchema = z
  .object({
    layout: z.enum(LAYOUT_IDS).optional().describe('Template; see the enhancv://reference/resume-structure resource for names'),
    colors: z.array(hexColor).min(1).max(2).optional().describe('Up to two hex colors, e.g. ["#000000", "#008CFF"]'),
    fontBody: z.enum(BODY_FONTS).optional(),
    fontHeading: z.enum(HEADING_FONTS).optional(),
    fontSize: z.number().int().min(0).max(4).optional(),
    hideBranding: z.boolean().optional().describe('Hide Enhancv branding'),
    isLetterSize: z.boolean().optional().describe('true = US Letter, false = A4'),
    marginOption: z.number().int().min(0).max(4).optional(),
    pageMarginOption: z.number().int().min(0).max(5).optional(),
    columnLayoutOption: z.number().int().min(0).max(3).optional(),
    lineHeightOption: z.number().int().min(0).max(2).optional(),
    headerExtraSpacing: z.number().int().min(0).max(4).optional()
  })
  .strict();

/** Request body of `POST /resumes`. Fields set to an empty string are hidden by Enhancv. */
export const createResumeSchema = z
  .object({
    title: str(200).optional().describe('Resume title in the Enhancv dashboard'),
    header: headerSchema.describe('Contact block (required)'),
    sections: sectionsSchema.describe('Sections keyed by type (required); every section needs a column'),
    style: styleSchema.optional()
  })
  .strict()
  .superRefine((resume, ctx) => {
    const usesThirdColumn = Object.entries(resume.sections).find(([, value]) => value?.column === 2);
    if (usesThirdColumn && resume.style?.layout !== 'multicolumn') {
      ctx.addIssue({
        code: 'custom',
        path: ['sections', usesThirdColumn[0], 'column'],
        message: 'column 2 (third column) is only allowed when style.layout is "multicolumn".'
      });
    }
  });

export type CreateResumeInput = z.infer<typeof createResumeSchema>;
