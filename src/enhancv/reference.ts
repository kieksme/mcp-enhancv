/**
 * Markdown reference documents exposed as MCP resources. The section/field tables are derived from the
 * Zod schemas, so the documentation cannot drift from what the server actually validates.
 */
import type * as z from 'zod/v4';
import { BODY_FONTS, HEADING_FONTS, LAYOUTS, SECTION_KEYS, sectionsSchema, type SectionKey } from './schemas.js';
import { ICONS } from './icons.js';

type AnyObject = z.ZodObject<z.ZodRawShape>;

/** Names of the item fields of one section type, read from its Zod schema. */
export function itemFields(key: SectionKey): string[] {
  const section = (sectionsSchema.shape[key] as unknown as z.ZodOptional<AnyObject>).unwrap();
  const items = (section.shape.items as unknown as z.ZodOptional<z.ZodArray<AnyObject>>).unwrap();
  return Object.keys(items.element.shape);
}

/** Section-level fields besides column/order/name/items (only skills-like sections have any). */
function extraSectionFields(key: SectionKey): string[] {
  const section = (sectionsSchema.shape[key] as unknown as z.ZodOptional<AnyObject>).unwrap();
  return Object.keys(section.shape).filter(field => !['column', 'order', 'name', 'items'].includes(field));
}

export function buildResumeStructureReference(): string {
  const sectionRows = SECTION_KEYS.map(key => {
    const extra = extraSectionFields(key);
    return `| \`${key}\` | ${itemFields(key).map(field => `\`${field}\``).join(', ')}${extra.length ? ` (section also: ${extra.map(field => `\`${field}\``).join(', ')})` : ''} |`;
  });
  const layoutRows = Object.entries(LAYOUTS).map(([id, name]) => `| \`${id}\` | ${name} |`);

  return `# Enhancv resume structure

Used by \`enhancv_create_resume\` and returned by \`enhancv_get_resume\` (the formats are identical).
Source: https://developers.enhancv.com/api/resume-structure

## Top level
\`\`\`json
{ "title": "optional", "header": { }, "sections": { }, "style": { "optional": true } }
\`\`\`
\`header\` and \`sections\` are required. Fields with an empty string, null or undefined are hidden; filled fields are shown automatically.
When a resume is retrieved only visible fields are returned.

## header
All optional strings: \`name\`, \`title\`, \`email\`, \`phone\`, \`location\`, \`website\`.

## sections
An object keyed by section type. Every section has:
- \`column\` (required): 0 = left, 1 = right, 2 = third column (only with \`style.layout\` "multicolumn")
- \`order\`: sort order, lower first (insertion order if omitted)
- \`name\`: heading shown on the resume
- \`items\`: array of items; all item fields are optional

| section key | item fields |
|---|---|
${sectionRows.join('\n')}

\`customs\`, \`customs2\` and \`customs3\` share one schema. \`skills\`/\`additionalTechnologies\` accept \`layoutMode\` ("tags" default, "compact", "bullets") and \`showBulletMarker\`.
\`industryExperiences\` is displayed as skills with a level, \`skills\` as technology groups with tags.

### Value ranges
- \`dateRange\`: \`fromYear\`, \`fromMonth\`, \`toYear\`, \`toMonth\`, \`isOngoing\`. **Months are 0-based (0 = January, 11 = December).** Omit \`toYear\`/\`toMonth\` for an ongoing period.
- \`industryExperiences[].level\`: 0-10. \`languages[].level\`: 0-5 (with \`levelText\`, e.g. "Native").
- \`icon\` values: see the enhancv://reference/icons resource (${ICONS.length} identifiers).

## style (all optional)
| field | values |
|---|---|
| \`layout\` | see table below |
| \`colors\` | up to two hex colors, e.g. \`["#000000", "#008CFF"]\` |
| \`fontBody\` | ${BODY_FONTS.join(', ')} |
| \`fontHeading\` | ${HEADING_FONTS.join(', ')} |
| \`fontSize\` | 0-4 |
| \`hideBranding\` | boolean |
| \`isLetterSize\` | true = US Letter, false = A4 |
| \`marginOption\` | 0-4 |
| \`pageMarginOption\` | 0-5 |
| \`columnLayoutOption\` | 0-3 |
| \`lineHeightOption\` | 0-2 |
| \`headerExtraSpacing\` | 0-4 |

### layout values
| API value | Template |
|---|---|
${layoutRows.join('\n')}
`;
}

export function buildIconReference(): string {
  return `# Enhancv icon identifiers

${ICONS.length} identifiers usable as \`icon\` in: achievements, awards, customs, interests, findMeOnline, strengths, industryExperiences.
Source: https://developers.enhancv.com/api/resume-structure

${ICONS.map(icon => `- ${icon}`).join('\n')}
`;
}
