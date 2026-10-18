import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadSheetSlots, internSheets } from '../lib/sheets.mjs';

const map = { version: 1, gutter: 2, count: 2, levels: [
  { edge: 32, sheets: [{ file: 'sheets/p32.webp', width: 72, height: 36 }], slots: { aa: [0, 2, 2, 32, 30], bb: [0, 38, 2, 20, 32] } },
  { edge: 128, sheets: [{ file: 'sheets/p128.webp', width: 132, height: 132 }, { file: 'sheets/q128.webp', width: 132, height: 132 }],
    slots: { aa: [0, 2, 2, 128, 120], bb: [1, 2, 2, 80, 128], zz: [9, 0, 0, 1, 1] } },
] };

test('loadSheetSlots maps each cover hash to one slot per level, and tolerates absence', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'wunderkammer-sheets-'));
  try {
    assert.equal(await loadSheetSlots(dir), null);
    await writeFile(path.join(dir, 'sheets.json'), JSON.stringify(map));
    const slots = await loadSheetSlots(dir);
    assert.deepEqual(slots.get('aa').map(([s, ...r]) => [s.src, s.edge, ...r]),
      [['/media/sheets/p32.webp', 32, 2, 2, 32, 30], ['/media/sheets/p128.webp', 128, 2, 2, 128, 120]]);
    assert.equal(slots.get('bb')[1][0].src, '/media/sheets/q128.webp');
    assert.equal(slots.has('zz'), false, 'a slot naming a missing page is dropped');
    await writeFile(path.join(dir, 'sheets.json'), JSON.stringify({ ...map, version: 99, pad: 'changes the size' }));
    assert.equal(await loadSheetSlots(dir), null, 'a foreign version falls back to per-file covers');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('internSheets sends each page once and leaves clips without slots alone', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'wunderkammer-sheets-'));
  try {
    await writeFile(path.join(dir, 'sheets.json'), JSON.stringify(map));
    const slots = await loadSheetSlots(dir);
    const clips = [{ id: 1, sheetSlots: slots.get('bb') }, { id: 2 }, { id: 3, sheetSlots: slots.get('aa') }];
    const sheets = internSheets(clips);
    assert.deepEqual(sheets.map(s => s.src), ['/media/sheets/p32.webp', '/media/sheets/q128.webp', '/media/sheets/p128.webp']);
    assert.deepEqual(clips[0].sheetSlots, [[0, 38, 2, 20, 32], [1, 2, 2, 80, 128]]);
    assert.equal('sheetSlots' in clips[1], false);
    assert.deepEqual(clips[2].sheetSlots, [[0, 2, 2, 32, 30], [2, 2, 2, 128, 120]]);
    assert.deepEqual(internSheets([{ id: 4 }]), []);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
