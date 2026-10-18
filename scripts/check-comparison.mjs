#!/usr/bin/env node
/** Explicit target required: never accidentally test a different private instance. */
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import path from 'node:path';

const target=process.env.COMPARISON_URL;
if(!target)throw new Error('Set COMPARISON_URL to the verified task-owned /wall/compare.html URL.');
const out=path.resolve(process.env.COMPARISON_PROOF_DIR||'.local/comparison-spike/proof');
await mkdir(out,{recursive:true});
const browser=await chromium.launch({headless:true});
const errors=[];const report={url:target};
try {
  const page=await browser.newPage({viewport:{width:1440,height:1050},reducedMotion:'reduce'});
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto(target);await page.waitForSelector('body[data-comparison-ready=true]');
  await page.waitForSelector('body[data-scene-ready=true]',{timeout:30000});
  await page.waitForFunction(()=>window.comparisonDebug().scene?.rendered);
  await page.locator('[data-view=depth]').click();
  const initial=await page.evaluate(()=>window.comparisonDebug());
  assert(initial.cohorts.length>=2);assert(initial.scene.visibleMeshCount>0);
  report.initial={corpus:initial.spec.corpus,groups:initial.cohorts.map(c=>({key:c.key,count:c.count})),scene:initial.scene};
  await page.screenshot({path:path.join(out,'depth.png'),fullPage:true});
  await page.locator('.cell-button').filter({hasText:/[1-9]/}).first().click();
  const selected=await page.evaluate(()=>window.comparisonDebug());assert(selected.evidenceKeys.length>0);
  await page.selectOption('#metric','count');
  assert.deepEqual((await page.evaluate(()=>window.comparisonDebug())).evidenceKeys,selected.evidenceKeys);
  await page.locator('#comparison-stage canvas').focus();await page.keyboard.press('ArrowLeft');
  const saved=await page.evaluate(()=>window.comparisonDebug());
  const fresh=await browser.newPage({viewport:{width:1440,height:1050},reducedMotion:'reduce'});
  fresh.on('pageerror',e=>errors.push(e.message));await fresh.goto(page.url());
  await fresh.waitForSelector('body[data-scene-ready=true]');
  const restored=await fresh.evaluate(()=>window.comparisonDebug());
  assert.deepEqual(restored.evidenceKeys,saved.evidenceKeys);assert.deepEqual(restored.selection,saved.selection);
  for(const axis of ['position','target'])saved.scene.camera[axis].forEach((n,i)=>assert(Math.abs(restored.scene.camera[axis][i]-n)<.0001));
  report.freshViewRestored=true;await fresh.close();
  for(const view of ['front','terraces','depth']){
    await page.locator(`[data-view=${view}]`).click();await page.screenshot({path:path.join(out,`${view}-selected.png`),fullPage:true});
  }
  await page.selectOption('#depth-slice',initial.cohorts[0].key);
  assert.equal((await page.evaluate(()=>window.comparisonDebug())).scene.visibleCohorts,1);
  assert.deepEqual((await page.evaluate(()=>window.comparisonDebug())).evidenceKeys,selected.evidenceKeys);
  report.slicePreservesEvidence=true;
  await page.selectOption('#depth-slice','');
  await page.locator('.evidence-item').first().click();assert(await page.locator('#item-dialog').isVisible());
  await page.keyboard.press('Escape');assert(!await page.locator('#item-dialog').isVisible());
  const mobile=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,reducedMotion:'reduce'});
  const phone=await mobile.newPage();phone.on('pageerror',e=>errors.push(e.message));
  await phone.goto(target);await phone.waitForSelector('body[data-scene-ready=true]');
  await phone.locator('.cell-button').filter({hasText:/[1-9]/}).first().tap();
  await phone.locator('.evidence-item').first().tap();await phone.getByRole('button',{name:'Close item',exact:true}).tap();
  const geometry=await phone.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth}));
  assert(geometry.scroll<=geometry.width);report.mobile=geometry;
  await phone.screenshot({path:path.join(out,'phone.png'),fullPage:true});await mobile.close();
  assert.deepEqual(errors,[]);report.errors=errors;
  await writeFile(path.join(out,'verification.json'),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({passed:true,proof:out,groups:report.initial.groups,scene:report.initial.scene,restored:true,mobile:report.mobile}));
}finally{await browser.close();}
