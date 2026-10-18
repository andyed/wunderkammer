#!/usr/bin/env node
// Reproducible live demo. Only writes local proof and an immutable view link.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { encodeView, decodeView, viewDigest } from '../wall/permalink.mjs';
const origin = process.env.MUSIC_ATLAS_URL || 'http://127.0.0.1:4175';
const output = path.resolve('.local/attribute-demo');
await mkdir(output, { recursive: true });
const data = await (await fetch(`${origin}/api/clips`)).json();
const oldView = { v:1, layoutVersion:1, corpus:data.corpus,
  scope:{query:'',facets:[],branches:null}, presentation:{group:'decade',mode:'flat',pan:'free'},
  flat:{aspect:.9037245491606969,stage:{h:996.6666870117188,w:905.3333740234375},view:{fitted:true,scale:.07055661048666262,x:24,y:56.50623807214248}},
  spatial:null,ui:{context:false,detailWidth:null,focus:null,mediaSource:null,rail:true,scopeBar:false} };
const browser = await chromium.launch();
const errors = [];
const page = await browser.newPage({viewport:{width:1600,height:1000}});
page.on('pageerror', e => errors.push(e.message));
const settle = p => p.waitForTimeout(700);
const geometry = p => p.evaluate(() => ({ camera:document.querySelector('#canvas').style.transform,
  items:[...document.querySelectorAll('.tile')].map(t=>[t.getAttribute('aria-label'),t.style.transform]),count:document.querySelector('#count').textContent }));
const decoded = p => decodeView(new URLSearchParams(new URL(p.url()).hash.slice(1)).get('s'));
async function ready(p) { await p.waitForSelector('body[data-view-ready=true]'); await settle(p); }
async function screenshot(p,name) {
  await p.evaluate(async()=>{
    await Promise.all([...document.querySelectorAll('.tile img')].filter(i=>i.src&&!i.dataset.src).map(i=>i.decode().catch(()=>{})));
    await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);
  });
  await p.screenshot({path:path.join(output,name+'.png')});
}
try {
  await page.goto(`${origin}/#v=1&s=${encodeView(oldView)}`);await ready(page);
  assert.equal(await page.locator('#sort-key').inputValue(),'none');
  assert.equal(await page.locator('#attribute-lens').inputValue(),'none');
  await page.locator('.chip[data-facet=genre][data-value="Classic Rock"]').click();await settle(page);
  await page.locator('.chip[data-facet=decade][data-value="1970s"]').click();await settle(page);
  await page.selectOption('#group','none');await page.selectOption('#sort-key','year');
  await page.selectOption('#attribute-lens','year');await page.locator('#search').hover();await settle(page);
  const before = await geometry(page), url = page.url();
  assert(before.items.length > 20 && before.items.length < 100,'readable live subset');
  await screenshot(page,'year-lens');
  await page.locator('.facet-heading[data-attribute=color]').hover();await settle(page);
  assert.deepEqual(await geometry(page),before);assert.equal(page.url(),url);
  await screenshot(page,'color-preview');
  await page.locator('.chip[data-facet=color][data-value=blue]').hover();await settle(page);
  assert(await page.locator('.tile.brush-match').count()>0);
  assert(await page.locator('.tile.brush-miss').count()>0);
  assert.deepEqual(await geometry(page),before);assert.equal(page.url(),url);
  await screenshot(page,'blue-brush');
  await page.locator('#search').hover();await settle(page);
  assert.equal(await page.locator('#canvas').getAttribute('data-brush-key'),'year');
  await page.click('#sort-direction');await settle(page);
  assert.equal(decoded(page).presentation.sort.direction,'desc');
  await page.goBack();await settle(page);
  assert.equal(decoded(page).presentation.sort.direction,'asc');
  assert.deepEqual(await geometry(page),before);
  const spec = decoded(page);
  const response = await fetch(`${origin}/api/permalinks`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(spec)});
  assert.equal(response.status,201);
  const { id } = await response.json();assert.equal(id,await viewDigest(spec));
  const link = `${origin}/#v=1&ref=${id}`;
  const fresh = await browser.newPage({viewport:{width:1600,height:1000}});
  fresh.on('pageerror',e=>errors.push(e.message));
  await fresh.goto(link);await ready(fresh);
  assert.deepEqual(await geometry(fresh),before);
  assert.equal(await fresh.locator('#attribute-lens').inputValue(),'year');
  await fresh.setViewportSize({width:700,height:900});await settle(fresh);
  for(const selector of ['#sort-key','#sort-direction','#attribute-lens']){
    const box=await fresh.locator(selector).boundingBox();assert(box.x>=0&&box.x+box.width<=701);
  }
  await screenshot(fresh,'narrow');
  const loaded = await page.locator('.tile img').evaluateAll(imgs=>({total:imgs.length,loaded:imgs.filter(i=>i.complete&&i.naturalWidth>0).length}));
  assert.equal(loaded.loaded,loaded.total);
  assert.deepEqual(errors,[]);
  const proof={link,albums:before.items.length,loaded,sort:spec.presentation.sort,lens:spec.ui.lens,errors,
    checks:['legacy URL defaults','hover stable geometry and URL','value membership','pin restores after hover','Back restores sort','fresh immutable link exact geometry','700px controls']};
  await writeFile(path.join(output,'proof.json'),JSON.stringify(proof,null,2));
  console.log(JSON.stringify(proof,null,2));
} finally { await browser.close(); }
