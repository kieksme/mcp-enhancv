/**
 * Synthetic Enhancv account used by the evaluations and the mock API.
 *
 * All people, employers and addresses are fictional (example.com, RFC 2606). No real resume data is used.
 * The data is shaped like the Enhancv "analyzer format" (see https://developers.enhancv.com/api/resume-structure).
 * Months are 0-based, exactly as in the real API.
 */

export type FixtureResume = {
  id: string;
  title: string;
  filename: string;
  createdAt: string;
  updatedAt: string;
  data: Record<string, unknown>;
};

type Month = [year: number, month: number];

const rid = (n: number): string => `64f1a2b3c4d5e6f7a8b9c0${n.toString(16).padStart(2, '0')}`;

const range = (from: Month, to?: Month) =>
  to
    ? { fromYear: from[0], fromMonth: from[1], toYear: to[0], toMonth: to[1] }
    : { fromYear: from[0], fromMonth: from[1], isOngoing: true };

const exp = (workplace: string, position: string, from: Month, to?: Month) => ({
  workplace,
  position,
  location: 'Remote',
  dateRange: range(from, to),
  bullets: [`Delivered projects as ${position}`]
});

const experiences = (...items: ReturnType<typeof exp>[]) => ({ name: 'Experience', column: 0, order: 1, items });
const summary = (text: string) => ({ name: 'Summary', column: 0, order: 0, items: [{ text }] });
const skills = (...levels: [string, number][]) => ({
  name: 'Skills',
  column: 1,
  order: 0,
  items: levels.map(([name, level]) => ({ name, level }))
});
const languages = (...entries: [string, number, string][]) => ({
  name: 'Languages',
  column: 1,
  order: 1,
  items: entries.map(([name, level, levelText]) => ({ name, level, levelText }))
});
const certificates = (...entries: [string, string][]) => ({
  name: 'Certifications',
  column: 1,
  order: 2,
  items: entries.map(([title, issuer]) => ({ title, issuer }))
});

const resume = (
  title: string,
  name: string,
  position: string,
  location: string,
  style: { layout: string; isLetterSize: boolean; fontHeading: string },
  sections: Record<string, unknown>
) => ({
  title,
  header: { name, title: position, email: `${name.toLowerCase().replace(/[^a-z]+/g, '.')}@example.com`, location },
  sections,
  style: { colors: ['#000000', '#008CFF'], fontBody: 'opensans', ...style }
});

const entry = (n: number, updatedAt: string, data: ReturnType<typeof resume>): FixtureResume => ({
  id: rid(n),
  title: data.title,
  filename: `${data.header.name.replaceAll(' ', '')}Resume.pdf`,
  createdAt: `2024-01-${String(n).padStart(2, '0')}T09:00:00.000Z`,
  updatedAt,
  data
});

export const FIXTURE_RESUMES: FixtureResume[] = [
  entry(1, '2024-03-11T10:00:00.000Z', resume('Backend Engineer', 'Mira Hoffmann', 'Backend Engineer', 'Berlin, Germany', { layout: 'double', isLetterSize: true, fontHeading: 'montserrat' }, {
    summaries: summary('Builds reliable APIs.'),
    experiences: experiences(exp('Fabrikam Payments', 'Backend Engineer', [2021, 5], [2024, 1]), exp('Adatum Labs', 'Software Engineer', [2018, 8], [2021, 4]), exp('Tailspin Toys', 'Junior Developer', [2016, 9], [2018, 7])),
    industryExperiences: skills(['Go', 9], ['PostgreSQL', 7]),
    languages: languages(['German', 5, 'Native'], ['English', 4, 'Fluent'])
  })),
  entry(2, '2024-05-20T10:00:00.000Z', resume('Frontend Developer', 'Diego Álvarez', 'Frontend Developer', 'Madrid, Spain', { layout: 'timeline', isLetterSize: false, fontHeading: 'raleway' }, {
    summaries: summary('Crafts accessible interfaces.'),
    experiences: experiences(exp('Wingtip Media', 'Frontend Developer', [2019, 2], [2024, 3]), exp('Litware Studio', 'Web Developer', [2016, 6], [2019, 1])),
    industryExperiences: skills(['TypeScript', 8], ['CSS', 8]),
    languages: languages(['Spanish', 5, 'Native'], ['English', 4, 'Fluent'])
  })),
  entry(3, '2024-11-02T10:00:00.000Z', resume('DevOps Consultant', 'Rui Costa', 'DevOps Consultant', 'Porto, Portugal', { layout: 'single', isLetterSize: false, fontHeading: 'lato' }, {
    summaries: summary('Automates delivery pipelines.'),
    experiences: experiences(exp('Proseware Consulting', 'DevOps Consultant', [2020, 0], [2024, 9]), exp('Lucerne Hosting', 'Systems Administrator', [2015, 3], [2019, 11])),
    industryExperiences: skills(['Terraform', 8], ['Kubernetes', 7]),
    certificates: certificates(['Vault Associate', 'HashiCorp'])
  })),
  entry(4, '2024-04-08T10:00:00.000Z', resume('Operations Lead', 'Lena Fischer', 'Operations Lead', 'Munich, Germany', { layout: 'classic', isLetterSize: true, fontHeading: 'bitter' }, {
    summaries: summary('Keeps supply chains moving.'),
    experiences: experiences(exp('Northwind Logistics', 'Operations Lead', [2020, 6]), exp('Alpine Freight', 'Dispatcher', [2014, 1], [2020, 5])),
    industryExperiences: skills(['Planning', 8], ['SAP', 6]),
    languages: languages(['German', 5, 'Native'])
  })),
  entry(5, '2024-06-15T10:00:00.000Z', resume('Platform Engineer - SRE', 'Tomás Ribeiro', 'Site Reliability Engineer', 'Lisbon, Portugal', { layout: 'double', isLetterSize: false, fontHeading: 'rubik' }, {
    summaries: summary('Runs resilient platforms.'),
    experiences: experiences(exp('Contoso Cloud', 'Site Reliability Engineer', [2021, 2], [2024, 4]), exp('Blue Yonder Apps', 'Systems Engineer', [2017, 9], [2021, 1]), exp('Graphic Design Institute', 'IT Support', [2015, 0], [2017, 8])),
    industryExperiences: skills(['Observability', 9], ['Terraform', 8]),
    languages: languages(['Portuguese', 5, 'Native'], ['English', 4, 'Fluent']),
    certificates: certificates(['Terraform Associate', 'HashiCorp'])
  })),
  entry(6, '2024-02-02T10:00:00.000Z', resume('Engineering Manager', 'Nora Lindqvist', 'Engineering Manager', 'Stockholm, Sweden', { layout: 'timeline', isLetterSize: true, fontHeading: 'oswald' }, {
    summaries: summary('Grows engineering teams.'),
    experiences: experiences(exp('Northwind Traders', 'Engineering Manager', [2019, 4], [2024, 0]), exp('Contoso Cloud', 'Senior Engineer', [2015, 8], [2019, 3]), exp('Fourth Coffee', 'Engineer', [2012, 5], [2015, 7]), exp('Margie Travel', 'Developer', [2010, 8], [2012, 4]), exp('City Power', 'Intern', [2009, 5], [2010, 7])),
    industryExperiences: skills(['Leadership', 8])
  })),
  entry(7, '2024-07-30T10:00:00.000Z', resume('Data Platform Lead', 'Priya Nair', 'Data Platform Lead', 'Bengaluru, India', { layout: 'polished', isLetterSize: false, fontHeading: 'montserrat' }, {
    summaries: summary('Leads data engineering.'),
    experiences: experiences(exp('Woodgrove Analytics', 'Data Platform Lead', [2020, 10], [2024, 6]), exp('Tailspin Data', 'Data Engineer', [2016, 7], [2020, 9]), exp('Relecloud', 'Analyst', [2014, 6], [2016, 6])),
    industryExperiences: skills(['Spark', 10], ['SQL', 9], ['Airflow', 9], ['Python', 8])
  })),
  entry(8, '2024-08-12T10:00:00.000Z', resume('Security Analyst', 'Omar Haddad', 'Security Analyst', 'Cairo, Egypt', { layout: 'minimal', isLetterSize: true, fontHeading: 'tinos' }, {
    summaries: summary('Hunts threats.'),
    experiences: experiences(exp('Trey Research', 'Security Analyst', [2021, 0], [2024, 5]), exp('Humongous Insurance', 'SOC Analyst', [2018, 3], [2020, 11]), exp('Coho Winery', 'IT Auditor', [2016, 1], [2018, 2]), exp('Fabrikam Residences', 'Helpdesk', [2014, 8], [2015, 12])),
    industryExperiences: skills(['SIEM', 8])
  })),
  entry(9, '2024-09-09T10:00:00.000Z', resume('Cloud Architect', 'Camille Dupont', 'Cloud Architect', 'Lisbon, Portugal', { layout: 'double', isLetterSize: false, fontHeading: 'playfair' }, {
    summaries: summary('Designs multi-cloud systems.'),
    experiences: experiences(exp('Adventure Works Cloud', 'Cloud Architect', [2019, 1], [2024, 7]), exp('Wide World Importers', 'Solutions Engineer', [2014, 9], [2018, 12]), exp('Southridge Video', 'Developer', [2011, 3], [2014, 8])),
    industryExperiences: skills(['AWS', 9], ['Azure', 8]),
    languages: languages(['French', 5, 'Native'], ['Spanish', 5, 'Native']),
    certificates: certificates(['Solutions Architect Professional', 'Amazon Web Services'])
  })),
  entry(10, '2024-01-25T10:00:00.000Z', resume('Logistics Analyst', 'Hannes Berg', 'Logistics Analyst', 'Vienna, Austria', { layout: 'timeline', isLetterSize: false, fontHeading: 'robotoslab' }, {
    summaries: summary('Optimizes transport routes.'),
    experiences: experiences(exp('Northwind Logistics', 'Logistics Analyst', [2016, 2], [2019, 8]), exp('Danube Shipping', 'Trainee', [2014, 9], [2016, 1])),
    industryExperiences: skills(['Excel', 7])
  })),
  entry(11, '2024-10-10T10:00:00.000Z', resume('Product Designer', 'Aiko Tanaka', 'Product Designer', 'Tokyo, Japan', { layout: 'single', isLetterSize: true, fontHeading: 'abril' }, {
    summaries: summary('Designs calm products.'),
    experiences: experiences(exp('Lamna Healthcare', 'Product Designer', [2018, 3])),
    industryExperiences: skills(['Figma', 9]),
    languages: languages(['Japanese', 5, 'Native'], ['Spanish', 4, 'Fluent'])
  })),
  entry(12, '2024-03-30T10:00:00.000Z', resume('Site Reliability Intern', 'Sam Okafor', 'SRE Intern', 'Lagos, Nigeria', { layout: 'newcondensed', isLetterSize: false, fontHeading: 'montserrat' }, {
    summaries: summary('Learning production operations.'),
    experiences: experiences(exp('Northwind Systems', 'SRE Intern', [2023, 6], [2024, 1])),
    industryExperiences: skills(['Linux', 9], ['Bash', 9], ['Git', 7])
  }))
];
