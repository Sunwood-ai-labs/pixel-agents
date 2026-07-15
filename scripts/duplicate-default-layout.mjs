import fs from 'node:fs';
import path from 'node:path';

const [, , inputPath, outputPath, copiesRaw = '2', revisionRaw = '2'] = process.argv;
if (!inputPath || !outputPath) {
  throw new Error(
    'Usage: node scripts/duplicate-default-layout.mjs <input> <output> [copies] [revision]',
  );
}

const copies = Number.parseInt(copiesRaw, 10);
const revision = Number.parseInt(revisionRaw, 10);
if (!Number.isInteger(copies) || copies < 2) throw new Error('copies must be at least 2');
if (!Number.isInteger(revision) || revision < 1) throw new Error('revision must be positive');

const source = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
if (source.version !== 1 || !Number.isInteger(source.cols) || !Number.isInteger(source.rows)) {
  throw new Error('input must be an OfficeLayout version 1');
}
if (!Array.isArray(source.tiles) || source.tiles.length !== source.cols * source.rows) {
  throw new Error('input tiles do not match cols × rows');
}

function duplicateRows(values) {
  const duplicated = [];
  for (let row = 0; row < source.rows; row++) {
    const sourceRow = values.slice(row * source.cols, (row + 1) * source.cols);
    for (let copy = 0; copy < copies; copy++) duplicated.push(...sourceRow);
  }
  return duplicated;
}

function duplicatePlaced(items, idKey, offsetColumns) {
  return Array.from({ length: copies }, (_, copy) =>
    items.map((item) => ({
      ...item,
      [idKey]: copy === 0 ? item[idKey] : `${item[idKey]}--zone-copy-${copy + 1}`,
      ...(offsetColumns ? { col: item.col + source.cols * copy } : {}),
    })),
  ).flat();
}

const output = {
  ...source,
  cols: source.cols * copies,
  tiles: duplicateRows(source.tiles),
  furniture: duplicatePlaced(source.furniture ?? [], 'uid', true),
  ...(Array.isArray(source.tileColors) ? { tileColors: duplicateRows(source.tileColors) } : {}),
  ...(Array.isArray(source.pets) ? { pets: duplicatePlaced(source.pets, 'id', false) } : {}),
  layoutRevision: revision,
};

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`);
console.log(
  `[duplicate-default-layout] ${source.cols}×${source.rows} → ${output.cols}×${output.rows}; ${copies} complete zone sets`,
);
