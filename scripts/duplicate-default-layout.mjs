import fs from 'node:fs';
import path from 'node:path';

const [, , inputPath, outputPath, copiesRaw = '1', revisionRaw = '4', rowCopiesRaw = '4'] =
  process.argv;
if (!inputPath || !outputPath) {
  throw new Error(
    'Usage: node scripts/duplicate-default-layout.mjs <input> <output> [column-copies] [revision] [row-copies]',
  );
}

const copies = Number.parseInt(copiesRaw, 10);
const revision = Number.parseInt(revisionRaw, 10);
const rowCopies = Number.parseInt(rowCopiesRaw, 10);
if (!Number.isInteger(copies) || copies < 1) throw new Error('column-copies must be positive');
if (!Number.isInteger(revision) || revision < 1) throw new Error('revision must be positive');
if (!Number.isInteger(rowCopies) || rowCopies < 1) throw new Error('row-copies must be positive');

const source = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
if (source.version !== 1 || !Number.isInteger(source.cols) || !Number.isInteger(source.rows)) {
  throw new Error('input must be an OfficeLayout version 1');
}
if (!Array.isArray(source.tiles) || source.tiles.length !== source.cols * source.rows) {
  throw new Error('input tiles do not match cols × rows');
}

function duplicateRows(values) {
  const duplicated = [];
  for (let rowCopy = 0; rowCopy < rowCopies; rowCopy++) {
    // Only the first row needs the ten-tile title margin. Repeated rows begin
    // at the visible top wall so the office remains compact rather than being
    // separated by an empty shaft.
    const firstSourceRow = rowCopy === 0 ? 0 : 10;
    for (let row = firstSourceRow; row < source.rows; row++) {
      const sourceRow = values.slice(row * source.cols, (row + 1) * source.cols);
      for (let copy = 0; copy < copies; copy++) duplicated.push(...sourceRow);
    }
  }
  return duplicated;
}

function duplicatePlaced(items, idKey, offsetPosition) {
  const rowStride = source.rows - 10;
  return Array.from({ length: rowCopies }, (_, rowCopy) =>
    Array.from({ length: copies }, (_, colCopy) => {
      const copyIndex = rowCopy * copies + colCopy;
      return items.map((item) => ({
        ...item,
        [idKey]: copyIndex === 0 ? item[idKey] : `${item[idKey]}--zone-copy-${copyIndex + 1}`,
        ...(offsetPosition
          ? { col: item.col + source.cols * colCopy, row: item.row + rowStride * rowCopy }
          : {}),
      }));
    }).flat(),
  ).flat();
}

const output = {
  ...source,
  cols: source.cols * copies,
  rows: source.rows + (source.rows - 10) * (rowCopies - 1),
  tiles: duplicateRows(source.tiles),
  furniture: duplicatePlaced(source.furniture ?? [], 'uid', true),
  ...(Array.isArray(source.tileColors) ? { tileColors: duplicateRows(source.tileColors) } : {}),
  ...(Array.isArray(source.pets) ? { pets: duplicatePlaced(source.pets, 'id', false) } : {}),
  layoutRevision: revision,
  zones: Array.from({ length: rowCopies }, (_, rowCopy) =>
    Array.from({ length: copies }, (_, copy) => {
      const offset = source.cols * copy;
      const rowOffset = (source.rows - 10) * rowCopy;
      const zoneBase = (rowCopy * copies + copy) * 2;
      return [
        {
          id: `zone-${zoneBase + 1}`,
          minCol: offset + 1,
          maxCol: offset + 9,
          minRow: rowOffset + 10,
          maxRow: rowOffset + 20,
        },
        {
          id: `zone-${zoneBase + 2}`,
          minCol: offset + 11,
          maxCol: offset + 19,
          minRow: rowOffset + 10,
          maxRow: rowOffset + 20,
        },
      ];
    }).flat(),
  ).flat(),
};

// Match the original four-tile-high doorway between its two rooms at every
// copied block boundary. A copied block ends as WALL + VOID and the next one
// starts with WALL; replacing those three columns with the adjacent floor
// patterns makes every room part of one walkable office.
const passageRows = [14, 15, 16, 17];
for (let copy = 1; copy < copies; copy++) {
  const boundary = source.cols * copy;
  for (const rowCopy of Array.from({ length: rowCopies }, (_, index) => index)) {
    for (const sourceRow of passageRows) {
      const row = sourceRow + (source.rows - 10) * rowCopy;
      const leftFloorIndex = row * output.cols + boundary - 3;
      const rightFloorIndex = row * output.cols + boundary + 1;
      for (const col of [boundary - 2, boundary - 1]) {
        output.tiles[row * output.cols + col] = output.tiles[leftFloorIndex];
        if (output.tileColors) {
          output.tileColors[row * output.cols + col] = structuredClone(
            output.tileColors[leftFloorIndex],
          );
        }
      }
      output.tiles[row * output.cols + boundary] = output.tiles[rightFloorIndex];
      if (output.tileColors) {
        output.tileColors[row * output.cols + boundary] = structuredClone(
          output.tileColors[rightFloorIndex],
        );
      }
    }
  }
}

// Connect the copied rows with three-tile-wide vertical hallways in both
// sections of every horizontal block. First draw an explicit wall threshold
// between the rows; the aligned three-tile openings below are the only breaks.
for (let rowCopy = 1; rowCopy < rowCopies; rowCopy++) {
  const lowerRowOffset = (source.rows - 10) * rowCopy;
  const upperFloorRow = lowerRowOffset + 8;
  const thresholdRow = lowerRowOffset + 9;
  const lowerFloorRow = lowerRowOffset + 10;
  for (let copy = 0; copy < copies; copy++) {
    for (let localCol = 0; localCol <= 19; localCol++) {
      const col = source.cols * copy + localCol;
      output.tiles[thresholdRow * output.cols + col] = 0;
      if (output.tileColors) output.tileColors[thresholdRow * output.cols + col] = null;
    }
    for (const localCenter of [5, 15]) {
      const center = source.cols * copy + localCenter;
      for (let row = upperFloorRow; row <= lowerFloorRow; row++) {
        for (const col of [center - 1, center, center + 1]) {
          const index = row * output.cols + col;
          const sourceIndex = (upperFloorRow - 1) * output.cols + col;
          output.tiles[index] = output.tiles[sourceIndex];
          if (output.tileColors)
            output.tileColors[index] = structuredClone(output.tileColors[sourceIndex]);
        }
      }
    }
  }
}

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`);
console.log(
  `[duplicate-default-layout] ${source.cols}×${source.rows} → ${output.cols}×${output.rows}; ${copies * rowCopies * 2} connected sections`,
);
