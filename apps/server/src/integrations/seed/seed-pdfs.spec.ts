import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { PDFParse } from 'pdf-parse';
import { deniedUserKeys } from './seed-definition';
import { SEED_PAGES, SEED_PDFS } from './seed-pages';
import { generateSeedPdfs, SeedPdfOutput } from './seed-pdfs';

const GENERATED_DIR = join(__dirname, 'content', 'generated');
const CANARY_ANY = /CANARY-[0-9A-F]{8}/;
const GF_CANARY = 'CANARY-9E40B7A3';
const GF_CONTRACT = 'beratervertrag-unternehmensentwicklung.pdf';
const NO_RENEWAL_CONTRACT = 'subunternehmervertrag-tiefbau.pdf';
const SCAN = 'wartungsvertrag-serverraum-scan.pdf';

function installPdfWorkerForJest() {
  const workerPath = join(
    dirname(require.resolve('pdf-parse')),
    'pdf.worker.mjs',
  );
  const source = readFileSync(workerPath, 'utf8')
    .replace(/export\s*\{[^}]*\};?\s*$/, '')
    .replaceAll('import.meta.url', '"file:///pdf.worker.mjs"');
  new Function(source)();
}

async function extractPages(bytes: Uint8Array): Promise<string[]> {
  const parser = new PDFParse({ data: new Uint8Array(bytes) });
  try {
    const result = await parser.getText({ pageJoiner: '' });
    return result.pages.map((page) => page.text);
  } finally {
    await parser.destroy();
  }
}

const normalise = (text: string) => text.replace(/\s+/g, ' ').trim();

let output: SeedPdfOutput;
let pagesByPdf: Map<string, string[]>;

beforeAll(async () => {
  installPdfWorkerForJest();
  output = await generateSeedPdfs();
  pagesByPdf = new Map();
  for (const file of output.files) {
    pagesByPdf.set(file.name, await extractPages(file.bytes));
  }
});

const textOf = (name: string) => pagesByPdf.get(name)!.join('\n');

describe('seed PDFs', () => {
  it('SEED-AC19: generates exactly the 9 PDFs named in the page manifest', () => {
    expect(output.files.map((f) => f.name).sort()).toEqual(
      SEED_PDFS.map((p) => p.fileName).sort(),
    );
    const withTextLayer = output.files.filter(
      (f) => normalise(textOf(f.name)) !== '',
    );
    expect(withTextLayer).toHaveLength(8);
    const kinds = (kind: string) =>
      SEED_PDFS.filter((p) => p.kind === kind).length;
    expect([kinds('contract'), kinds('minutes'), kinds('scan')]).toEqual([
      6, 2, 1,
    ]);
    expect(output.groundTruth.filter((r) => r.textLayer)).toHaveLength(6);
    expect(output.groundTruth.filter((r) => !r.textLayer)).toHaveLength(1);
  });

  it('SEED-AC20: every PDF has at most 5 pages and at most 1 MB', () => {
    for (const file of output.files) {
      expect(pagesByPdf.get(file.name)!.length).toBeLessThanOrEqual(5);
      expect(file.bytes.length).toBeLessThanOrEqual(1024 * 1024);
    }
    for (const record of output.groundTruth.filter((r) => r.textLayer)) {
      const pageCount = pagesByPdf.get(record.pdf)!.length;
      expect(pageCount).toBeGreaterThanOrEqual(2);
      expect(pageCount).toBeLessThanOrEqual(4);
    }
  });

  it('SEED-AC21: every field quote occurs verbatim on its PDF page', () => {
    const textContracts = output.groundTruth.filter((r) => r.textLayer);
    let checked = 0;
    for (const record of textContracts) {
      const pages = pagesByPdf.get(record.pdf)!.map(normalise);
      for (const field of Object.values(record.fields)) {
        if ('missing' in field) continue;
        expect(field.pdfPage).toBeGreaterThanOrEqual(1);
        expect(pages[field.pdfPage - 1]).toContain(normalise(field.quote));
        expect(normalise(field.quote)).toContain(normalise(field.value));
        checked++;
      }
    }
    expect(checked).toBe(5 * 6 - 1);
  });

  it('SEED-AC22: only the renewal-less contract has a missing field, and it is renewal', () => {
    const missing = output.groundTruth.flatMap((record) =>
      Object.entries(record.fields)
        .filter(([, field]) => 'missing' in field)
        .map(([name, field]) => ({ pdf: record.pdf, name, field })),
    );
    expect(missing).toEqual([
      {
        pdf: NO_RENEWAL_CONTRACT,
        name: 'renewal',
        field: { missing: true },
      },
    ]);
  });

  it('SEED-AC23: the renewal-less contract contains none of the renewal terms', () => {
    const text = textOf(NO_RENEWAL_CONTRACT);
    expect(text.length).toBeGreaterThan(500);
    for (const term of ['Verlängerung', 'verlängert', 'Laufzeitende']) {
      expect(text).not.toContain(term);
    }
  });

  it('SEED-AC24: the scanned contract has no text layer and yields only whitespace', () => {
    const record = output.groundTruth.find((r) => r.pdf === SCAN)!;
    expect(record.textLayer).toBe(false);
    expect(normalise(textOf(SCAN))).toBe('');
    expect(
      output.files.find((f) => f.name === SCAN)!.bytes.length,
    ).toBeGreaterThan(10_000);
  });

  it('SEED-AC25: generating twice yields identical extracted text per PDF', async () => {
    const second = await generateSeedPdfs();
    expect(second.files.map((f) => f.name)).toEqual(
      output.files.map((f) => f.name),
    );
    for (const file of second.files) {
      expect(await extractPages(file.bytes)).toEqual(pagesByPdf.get(file.name));
    }
    expect(second.groundTruth).toEqual(output.groundTruth);
  });

  it('SEED-AC12: the GF canary occurs once in the GF contract and no other canary occurs in any PDF or ground-truth record', () => {
    const gfText = textOf(GF_CONTRACT);
    expect(gfText.split(GF_CANARY)).toHaveLength(2);
    for (const file of output.files) {
      if (file.name === GF_CONTRACT) continue;
      expect(textOf(file.name)).not.toMatch(CANARY_ANY);
    }
    expect(JSON.stringify(output.groundTruth)).not.toMatch(CANARY_ANY);
  });

  it('SEED-AC13: the canary list has the 8 page canaries with the denied users of their pages', () => {
    expect(output.canaries).toHaveLength(8);
    expect(new Set(output.canaries.map((c) => c.canary)).size).toBe(8);
    for (const entry of output.canaries) {
      const page = SEED_PAGES.find(
        (p) => p.space === entry.space && p.title === entry.title,
      )!;
      expect(page).toBeDefined();
      expect(entry.deniedUsers).toEqual(deniedUserKeys(page));
      expect(entry.deniedUsers.length).toBeGreaterThan(0);
    }
  });

  it('SEED-AC25: the committed ground truth, canary list and PDF text equal a fresh generation', async () => {
    const readJson = (name: string) =>
      JSON.parse(readFileSync(join(GENERATED_DIR, name), 'utf8'));
    expect(readJson('ground-truth.json')).toEqual(output.groundTruth);
    expect(readJson('canaries.json')).toEqual(output.canaries);
    for (const file of output.files) {
      const committed = new Uint8Array(
        readFileSync(join(GENERATED_DIR, file.name)),
      );
      expect(await extractPages(committed)).toEqual(pagesByPdf.get(file.name));
    }
  });
});
