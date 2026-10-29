import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { SCANNED_CONTRACT } from './content/contracts';
import { generateSeedPdfs, renderContractTextPdf } from './seed-pdfs';

const OUTPUT_DIR = join(__dirname, 'content', 'generated');
const SCAN_SOURCE_FLAG = '--scan-source';

const toJson = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;

async function main() {
  const flagIndex = process.argv.indexOf(SCAN_SOURCE_FLAG);
  if (flagIndex >= 0) {
    const target = process.argv[flagIndex + 1];
    writeFileSync(target, await renderContractTextPdf(SCANNED_CONTRACT));
    return;
  }

  const output = await generateSeedPdfs();
  mkdirSync(OUTPUT_DIR, { recursive: true });
  for (const file of output.files) {
    writeFileSync(join(OUTPUT_DIR, file.name), file.bytes);
  }
  writeFileSync(
    join(OUTPUT_DIR, 'ground-truth.json'),
    toJson(output.groundTruth),
  );
  writeFileSync(join(OUTPUT_DIR, 'canaries.json'), toJson(output.canaries));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
