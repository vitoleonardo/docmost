import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PDFDocument, PDFFont, StandardFonts } from 'pdf-lib';
import {
  ContractClause,
  ContractData,
  ContractFieldName,
  ContractSection,
  CONTRACTS,
  MINUTES,
  MinutesData,
  SCANNED_CONTRACT,
} from './content/contracts';
import { deniedUserKeys, SeedUserKey } from './seed-definition';
import { readSeedPageMarkdown, SEED_PAGES, SEED_PDFS } from './seed-pages';

export interface SeedPdfFile {
  name: string;
  bytes: Uint8Array;
}

export type GroundTruthField =
  | { value: string; quote: string; pdfPage: number }
  | { missing: true };

export interface ContractGroundTruth {
  pdf: string;
  textLayer: boolean;
  fields: Record<ContractFieldName, GroundTruthField>;
}

export interface SeedCanary {
  canary: string;
  space: string;
  title: string;
  deniedUsers: SeedUserKey[];
}

export interface SeedPdfOutput {
  files: SeedPdfFile[];
  groundTruth: ContractGroundTruth[];
  canaries: SeedCanary[];
}

interface RenderedDocument {
  bytes: Uint8Array;
  pageOfClause: Map<ContractFieldName, { text: string; pdfPage: number }>;
  pageCount: number;
}

interface Line {
  text: string;
  bold: boolean;
  size: number;
}

interface Block {
  lines: Line[];
  gapBefore: number;
  keepWithNext: boolean;
  field?: ContractFieldName;
  clauseText?: string;
}

const FIELD_NAMES: ContractFieldName[] = [
  'parties',
  'term',
  'noticePeriod',
  'value',
  'renewal',
];

const FIXED_DATE = new Date('2026-01-01T00:00:00.000Z');
const PRODUCER = 'Ostmooimooi seed PDF generator';
const SCAN_IMAGE_PATH = join(
  __dirname,
  'content',
  'scan',
  'wartungsvertrag-serverraum.png',
);

const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const MARGIN = 64;
const BODY_SIZE = 10.5;
const HEADING_SIZE = 12;
const TITLE_SIZE = 16;
const LEADING = 15;

function wrapWords(text: string, font: PDFFont, size: number): string[] {
  const maxWidth = PAGE_WIDTH - 2 * MARGIN;
  const lines: string[] = [];
  let current = '';
  for (const word of text.split(' ')) {
    const candidate = current ? `${current} ${word}` : word;
    if (current && font.widthOfTextAtSize(candidate, size) > maxWidth) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  lines.push(current);
  return lines;
}

function clauseParts(clause: ContractClause): {
  text: string;
  field?: ContractFieldName;
} {
  return typeof clause === 'string'
    ? { text: clause }
    : { field: clause[0], text: clause[1] };
}

function buildBlocks(
  title: string,
  sections: ContractSection[],
  numbered: boolean,
  fonts: { regular: PDFFont; bold: PDFFont },
): Block[] {
  const toLines = (text: string, bold: boolean, size: number): Line[] =>
    wrapWords(text, bold ? fonts.bold : fonts.regular, size).map((line) => ({
      text: line,
      bold,
      size,
    }));

  const blocks: Block[] = [
    {
      lines: toLines(title, true, TITLE_SIZE),
      gapBefore: 0,
      keepWithNext: true,
    },
  ];
  sections.forEach((section, sectionIndex) => {
    const heading = numbered
      ? `§ ${sectionIndex + 1} ${section.title}`
      : section.title;
    blocks.push({
      lines: toLines(heading, true, HEADING_SIZE),
      gapBefore: 16,
      keepWithNext: true,
    });
    section.clauses.forEach((clause, clauseIndex) => {
      const { text, field } = clauseParts(clause);
      const label = numbered ? `(${clauseIndex + 1}) ${text}` : text;
      blocks.push({
        lines: toLines(label, false, BODY_SIZE),
        gapBefore: 6,
        keepWithNext: false,
        field,
        clauseText: text,
      });
    });
  });
  return blocks;
}

const blockHeight = (block: Block) => block.lines.length * LEADING;

function layoutBlocks(
  pdf: PDFDocument,
  fonts: { regular: PDFFont; bold: PDFFont },
  blocks: Block[],
): number[] {
  const pageOfBlock: number[] = [];
  let pageNumber = 1;
  let page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  let y = PAGE_HEIGHT - MARGIN;
  const top = y;

  blocks.forEach((block, index) => {
    const next = block.keepWithNext ? blocks[index + 1] : undefined;
    const needed =
      block.gapBefore + blockHeight(block) + (next ? blockHeight(next) : 0);
    if (y !== top && y - needed < MARGIN) {
      page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
      pageNumber++;
      y = top;
    }
    if (y !== top) y -= block.gapBefore;
    for (const line of block.lines) {
      y -= LEADING;
      page.drawText(line.text, {
        x: MARGIN,
        y,
        size: line.size,
        font: line.bold ? fonts.bold : fonts.regular,
      });
    }
    pageOfBlock.push(pageNumber);
  });
  return pageOfBlock;
}

function newDocument(title: string): Promise<PDFDocument> {
  return PDFDocument.create({ updateMetadata: false }).then((pdf) => {
    pdf.setTitle(title);
    pdf.setProducer(PRODUCER);
    pdf.setCreator(PRODUCER);
    pdf.setCreationDate(FIXED_DATE);
    pdf.setModificationDate(FIXED_DATE);
    return pdf;
  });
}

async function renderTextDocument(
  title: string,
  sections: ContractSection[],
  numbered: boolean,
): Promise<RenderedDocument> {
  const pdf = await newDocument(title);
  const fonts = {
    regular: await pdf.embedFont(StandardFonts.Helvetica),
    bold: await pdf.embedFont(StandardFonts.HelveticaBold),
  };
  const blocks = buildBlocks(title, sections, numbered, fonts);
  const pageOfBlock = layoutBlocks(pdf, fonts, blocks);

  const pageOfClause: RenderedDocument['pageOfClause'] = new Map();
  blocks.forEach((block, index) => {
    if (!block.field) return;
    pageOfClause.set(block.field, {
      text: block.clauseText!,
      pdfPage: pageOfBlock[index],
    });
  });
  return {
    bytes: await pdf.save({ useObjectStreams: false }),
    pageOfClause,
    pageCount: pdf.getPageCount(),
  };
}

function minutesSections(minutes: MinutesData): ContractSection[] {
  return [
    { title: 'Datum', clauses: [minutes.date] },
    { title: 'Teilnehmende', clauses: minutes.participants },
    { title: 'Tagesordnung', clauses: minutes.agenda },
    { title: 'Beschlüsse', clauses: minutes.decisions },
  ];
}

function groundTruthOf(
  contract: ContractData,
  rendered: RenderedDocument,
  textLayer: boolean,
): ContractGroundTruth {
  const fields = {} as Record<ContractFieldName, GroundTruthField>;
  for (const name of FIELD_NAMES) {
    const value = contract.values[name];
    const clause = rendered.pageOfClause.get(name);
    if (value === null) {
      if (clause) {
        throw new Error(`${contract.pdf}: ${name} is missing but has a clause`);
      }
      fields[name] = { missing: true };
      continue;
    }
    if (!clause || !clause.text.includes(value)) {
      throw new Error(`${contract.pdf}: clause for ${name} lacks its value`);
    }
    fields[name] = { value, quote: clause.text, pdfPage: clause.pdfPage };
  }
  return { pdf: contract.pdf, textLayer, fields };
}

export async function renderContractTextPdf(
  contract: ContractData,
): Promise<Uint8Array> {
  return (await renderTextDocument(contract.title, contract.sections, true))
    .bytes;
}

async function renderScanPdf(contract: ContractData): Promise<Uint8Array> {
  const pdf = await newDocument(contract.title);
  const image = await pdf.embedPng(readFileSync(SCAN_IMAGE_PATH));
  const page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  page.drawImage(image, {
    x: 0,
    y: 0,
    width: PAGE_WIDTH,
    height: PAGE_HEIGHT,
  });
  return pdf.save({ useObjectStreams: false });
}

function collectCanaries(): SeedCanary[] {
  return SEED_PAGES.flatMap((page) =>
    [...readSeedPageMarkdown(page).matchAll(/CANARY-[0-9A-F]{8}/g)].map(
      (match) => ({
        canary: match[0],
        space: page.space,
        title: page.title,
        deniedUsers: deniedUserKeys(page),
      }),
    ),
  );
}

export async function generateSeedPdfs(): Promise<SeedPdfOutput> {
  const files: SeedPdfFile[] = [];
  const groundTruth: ContractGroundTruth[] = [];

  for (const { fileName } of SEED_PDFS) {
    const contract = CONTRACTS.find((c) => c.pdf === fileName);
    const minutes = MINUTES.find((m) => m.pdf === fileName);
    if (contract) {
      const rendered = await renderTextDocument(
        contract.title,
        contract.sections,
        true,
      );
      files.push({ name: fileName, bytes: rendered.bytes });
      groundTruth.push(groundTruthOf(contract, rendered, true));
    } else if (minutes) {
      const rendered = await renderTextDocument(
        minutes.title,
        minutesSections(minutes),
        false,
      );
      files.push({ name: fileName, bytes: rendered.bytes });
    } else if (fileName === SCANNED_CONTRACT.pdf) {
      files.push({
        name: fileName,
        bytes: await renderScanPdf(SCANNED_CONTRACT),
      });
    } else {
      throw new Error(`No data for ${fileName}`);
    }
  }

  const scanSource = await renderTextDocument(
    SCANNED_CONTRACT.title,
    SCANNED_CONTRACT.sections,
    true,
  );
  if (scanSource.pageCount !== 1) {
    throw new Error(
      `${SCANNED_CONTRACT.pdf}: the scan source must be one page`,
    );
  }
  groundTruth.push(groundTruthOf(SCANNED_CONTRACT, scanSource, false));

  return { files, groundTruth, canaries: collectCanaries() };
}
