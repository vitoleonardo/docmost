import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SeedPageRef } from './seed-definition';

export type SeedPdfKind = 'contract' | 'minutes' | 'scan';

export interface SeedPage extends SeedPageRef {
  file: string;
  attachments?: string[];
}

export interface SeedPdf {
  fileName: string;
  kind: SeedPdfKind;
  space: string;
  pageTitle: string;
  noRenewal?: true;
}

export interface SeedContradiction {
  fact: string;
  outdated: { space: string; title: string; value: string };
  current: { space: string; title: string; value: string };
}

export interface SeedOutdatedPage {
  space: string;
  title: string;
  statement: string;
}

export interface SeedIssues {
  contradictions: SeedContradiction[];
  outdated: SeedOutdatedPage[];
}

export const SEED_PAGES: SeedPage[] = [
  {
    space: 'Allgemein',
    title: 'Willkommen bei Ostmooimooi',
    file: 'allgemein/willkommen.md',
  },
  {
    space: 'Allgemein',
    title: 'Reisekosten Richtlinie 2022',
    file: 'allgemein/reisekosten-richtlinie-2022.md',
  },
  {
    space: 'Allgemein',
    title: 'Reisekosten Richtlinie 2026',
    file: 'allgemein/reisekosten-richtlinie-2026.md',
  },
  {
    space: 'Allgemein',
    title: 'Bürozeiten und Erreichbarkeit',
    file: 'allgemein/buerozeiten-erreichbarkeit.md',
  },
  {
    space: 'Allgemein',
    title: 'Umstrukturierung 2027',
    file: 'allgemein/umstrukturierung-2027.md',
  },

  {
    space: 'HR',
    title: 'Onboarding neuer Mitarbeitender',
    file: 'hr/onboarding.md',
  },
  {
    space: 'HR',
    title: 'Urlaubsantrag per Formular',
    file: 'hr/urlaubsantrag-formular.md',
  },
  {
    space: 'HR',
    title: 'Urlaubsantrag im Personalportal',
    file: 'hr/urlaubsantrag-personalportal.md',
  },
  {
    space: 'HR',
    title: 'Weiterbildung und Schulungen',
    file: 'hr/weiterbildung.md',
  },

  {
    space: 'Vertrieb',
    title: 'Vertriebsprozess Anlagenbau',
    file: 'vertrieb/vertriebsprozess.md',
  },
  {
    space: 'Vertrieb',
    title: 'Preisliste Standardkomponenten',
    file: 'vertrieb/preisliste.md',
  },
  {
    space: 'Vertrieb',
    title: 'Kundenvertrag Stadtwerke Beispielstadt',
    file: 'vertrieb/kundenvertrag-stadtwerke.md',
    attachments: ['kundenvertrag-stadtwerke-beispielstadt.pdf'],
  },
  {
    space: 'Vertrieb',
    title: 'Rahmenvertrag Wasserverband Muster',
    file: 'vertrieb/rahmenvertrag-wasserverband.md',
    attachments: ['rahmenvertrag-wasserverband-muster.pdf'],
  },

  {
    space: 'Projekte',
    title: 'Projektübersicht 2026',
    file: 'projekte/projektuebersicht-2026.md',
  },
  {
    space: 'Projekte',
    title: 'Besprechung Nordhafen Kickoff',
    parentTitle: 'Projektübersicht 2026',
    file: 'projekte/besprechung-nordhafen-kickoff.md',
    attachments: ['besprechungsprotokoll-nordhafen-kickoff.pdf'],
  },
  {
    space: 'Projekte',
    title: 'Besprechung Nordhafen Bauabnahme',
    parentTitle: 'Projektübersicht 2026',
    file: 'projekte/besprechung-nordhafen-bauabnahme.md',
    attachments: ['besprechungsprotokoll-nordhafen-bauabnahme.pdf'],
  },
  {
    space: 'Projekte',
    title: 'Angebot Kalkulation Kläranlage Nordhafen',
    file: 'projekte/angebot-kalkulation-nordhafen.md',
  },
  {
    space: 'Projekte',
    title: 'Baustelle Nordhafen intern',
    file: 'projekte/baustelle-nordhafen-intern.md',
  },
  {
    space: 'Projekte',
    title: 'Baustelle Nordhafen Zugangscodes',
    parentTitle: 'Baustelle Nordhafen intern',
    file: 'projekte/baustelle-nordhafen-zugangscodes.md',
  },
  {
    space: 'Projekte',
    title: 'Liefervertrag Pumpen Fiktivwerk',
    file: 'projekte/liefervertrag-pumpen.md',
    attachments: ['liefervertrag-pumpen-fiktivwerk.pdf'],
  },
  {
    space: 'Projekte',
    title: 'Subunternehmervertrag Tiefbau',
    file: 'projekte/subunternehmervertrag-tiefbau.md',
    attachments: ['subunternehmervertrag-tiefbau.pdf'],
  },

  {
    space: 'IT',
    title: 'VPN Einrichtung Classic',
    file: 'it/vpn-einrichtung-classic.md',
  },
  {
    space: 'IT',
    title: 'VPN Einrichtung Connect',
    file: 'it/vpn-einrichtung-connect.md',
  },
  {
    space: 'IT',
    title: 'Passwort und Zugangsregeln',
    file: 'it/passwort-zugangsregeln.md',
  },
  {
    space: 'IT',
    title: 'Softwarelizenzvertrag Planungssoftware',
    file: 'it/softwarelizenzvertrag.md',
    attachments: ['softwarelizenzvertrag-planungssoftware.pdf'],
  },
  {
    space: 'IT',
    title: 'Wartung Serverraum',
    file: 'it/wartung-serverraum.md',
    attachments: ['wartungsvertrag-serverraum-scan.pdf'],
  },

  {
    space: 'Geschäftsführung',
    title: 'Strategie 2027 bis 2030',
    file: 'geschaeftsfuehrung/strategie-2027-2030.md',
  },
  {
    space: 'Geschäftsführung',
    title: 'Beratervertrag Unternehmensentwicklung',
    file: 'geschaeftsfuehrung/beratervertrag.md',
    attachments: ['beratervertrag-unternehmensentwicklung.pdf'],
  },
  {
    space: 'Geschäftsführung',
    title: 'Gehaltsbänder Führungsebene',
    file: 'geschaeftsfuehrung/gehaltsbaender.md',
  },
  {
    space: 'Geschäftsführung',
    title: 'Liquiditätsplanung 2026',
    file: 'geschaeftsfuehrung/liquiditaetsplanung-2026.md',
  },
];

const PDF_KINDS: Record<string, SeedPdfKind> = {
  'kundenvertrag-stadtwerke-beispielstadt.pdf': 'contract',
  'rahmenvertrag-wasserverband-muster.pdf': 'contract',
  'liefervertrag-pumpen-fiktivwerk.pdf': 'contract',
  'subunternehmervertrag-tiefbau.pdf': 'contract',
  'softwarelizenzvertrag-planungssoftware.pdf': 'contract',
  'beratervertrag-unternehmensentwicklung.pdf': 'contract',
  'besprechungsprotokoll-nordhafen-kickoff.pdf': 'minutes',
  'besprechungsprotokoll-nordhafen-bauabnahme.pdf': 'minutes',
  'wartungsvertrag-serverraum-scan.pdf': 'scan',
};

const NO_RENEWAL_PDF = 'subunternehmervertrag-tiefbau.pdf';

export const SEED_PDFS: SeedPdf[] = SEED_PAGES.flatMap((page) =>
  (page.attachments ?? []).map((fileName) => ({
    fileName,
    kind: PDF_KINDS[fileName],
    space: page.space,
    pageTitle: page.title,
    ...(fileName === NO_RENEWAL_PDF ? { noRenewal: true as const } : {}),
  })),
);

export function findDuplicateTitles(pages: SeedPage[]): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const { title } of pages) {
    if (seen.has(title)) duplicates.add(title);
    seen.add(title);
  }
  return [...duplicates];
}

export function readSeedPageMarkdown(page: SeedPage): string {
  return readFileSync(join(__dirname, 'content', 'pages', page.file), 'utf8');
}

export function readSeedIssues(): SeedIssues {
  return JSON.parse(
    readFileSync(join(__dirname, 'content', 'issues.json'), 'utf8'),
  ) as SeedIssues;
}
