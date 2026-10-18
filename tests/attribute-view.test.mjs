import assert from 'node:assert/strict';
import { test, before, after, afterEach } from 'node:test';
import { createServer } from 'node:http';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { createPermalinkHandler } from '../lib/permalinks.mjs';
import { decodeView } from '../wall/permalink.mjs';
const cover = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128"><rect width="128" height="128" fill="#607e90"/></svg>');
const clips = Array.from({length: 36}, (_, i) => ({id: `c${i}`,url:`urn:album:${i}`,title:`Album ${String(i).padStart(2,'0')}`,source:i%2?'B':'A',captured:'',tags:[],cover,props:{year:i===0?[]:[String(1980+(35-i))],genre:[i%3?'Rock':'Jazz'],complexity:['low','medium','high'][i%3]}}));
const facets = {};
for (const clip of clips) for (const [key, value] of Object.entries({...clip.props,source:clip.source})) for (const v of Array.isArray(value)?value:[value]) { facets[key] ||= {}; facets[key][v]=(facets[key][v]||0)+1; }
let browser,server,origin,dir;
const pageErrors=[];
afterEach(()=>{assert.deepEqual(pageErrors.splice(0),[],'no uncaught browser errors');});
before(async()=>{
 dir=await mkdtemp(path.join(tmpdir(),'attribute-view-'));const snapshots=createPermalinkHandler(path.join(dir,'links'));
 server=createServer(async(req,res)=>{
  const url=new URL(req.url,'http://fixture');
  if(url.pathname.startsWith('/api/permalinks'))return snapshots(req,res,url.pathname.split('/')[3]);
  if(url.pathname==='/api/clips'){res.setHeader('content-type','application/json');res.end(JSON.stringify({clips,facets,corpus:{id:'attributes',revision:'r1'},ui:{defaultGroup:'source',facetOrder:['year','genre','complexity','source'],facetLabels:{year:'Release year'}}}));return;}
  if(url.pathname==='/api/view-state'){res.setHeader('content-type','application/json');res.end(JSON.stringify({version:1,mode:'mountain',groupKey:'source',piles:[]}));return;}
  if(url.pathname==='/'||/^\/wall\/[\w.-]+$/.test(url.pathname)){
   try{const file=url.pathname==='/'?'wall/index.html':url.pathname.slice(1);const data=await readFile(new URL('../'+file,import.meta.url));res.setHeader('content-type',file.endsWith('html')?'text/html':file.endsWith('css')?'text/css':'text/javascript');res.end(data);return;}catch{}
  }
  res.writeHead(404);res.end();
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));origin=`http://127.0.0.1:${server.address().port}`;browser=await chromium.launch();
});
after(async()=>{await browser?.close();await new Promise(r=>server?.close(r));await rm(dir,{recursive:true,force:true});});
const settle=p=>p.waitForTimeout(700);
async function open(width=1440){const p=await browser.newPage({viewport:{width,height:950}});p.on('pageerror',e=>pageErrors.push(e.message));await p.goto(origin);await p.waitForSelector('body[data-view-ready=true]');await settle(p);return p;}
async function geometry(p){return p.evaluate(()=>({count:document.querySelector('#count').textContent,canvas:document.querySelector('#canvas').style.transform,tiles:[...document.querySelectorAll('.tile')].map(t=>[t.getAttribute('aria-label'),t.style.transform])}));}
async function view(p){const hash=new URLSearchParams(new URL(p.url()).hash.slice(1));return hash.has('s')?decodeView(hash.get('s')):(await fetch(`${origin}/api/permalinks/${hash.get('ref')}`)).json();}

test('attribute hover previews preserve scope, positions, camera and permalink',async()=>{
 const p=await open();try{
  const before=await geometry(p),url=p.url();
  await p.locator('.chip[data-facet=genre][data-value=Jazz]').hover();await settle(p);
  assert.equal(await p.locator('.tile.brush-match').count(),12);
  assert.equal(await p.locator('.tile.brush-miss').count(),24);
  assert.deepEqual(await geometry(p),before);assert.equal(p.url(),url);
  await p.locator('.facet-heading[data-attribute=year]').hover();await settle(p);
  assert.equal(await p.locator('#canvas').getAttribute('data-brush-key'),'year');
  assert.equal(await p.locator('.tile.brush-unknown').count(),1);
  assert.deepEqual(await geometry(p),before);assert.equal(p.url(),url);
  await p.locator('#search').hover();await settle(p);
  assert.equal(await p.locator('#canvas').getAttribute('data-brush-key'),null);
  await p.locator('.facet-heading[data-attribute=year]').focus();await settle(p);
  assert.equal(await p.locator('#canvas').getAttribute('data-brush-key'),'year');
  await p.keyboard.press('Escape');await settle(p);
  assert.equal(await p.locator('#canvas').getAttribute('data-brush-key'),null);
 }finally{await p.close();}
});

test('sort reverses within groups and pinned attribute restores through a fresh permalink',async()=>{
 const p=await open();try{
  const initial=(await geometry(p)).count;
  await p.selectOption('#sort-key','year');await settle(p);
  const ids=await p.locator('.tile').evaluateAll(ts=>ts.map(t=>Number(t.getAttribute('aria-label').split(' ').at(-1))));
  const groups=['A','B'].map(g=>ids.filter(i=>clips[i].source===g));
  for(const group of groups){const known=group.filter(i=>i!==0);assert.deepEqual(known,[...known].sort((a,b)=>b-a));if(group.includes(0))assert.equal(group.at(-1),0);}
  await p.click('#sort-direction');await p.selectOption('#attribute-lens','year');await p.locator('#search').hover();await settle(p);
  assert.equal((await geometry(p)).count,initial);
  const spec=await view(p);assert.deepEqual(spec.presentation.sort,{key:'year',direction:'desc'});assert.equal(spec.ui.lens,'year');
  const sorted=await geometry(p);
  const restored=await browser.newPage({viewport:{width:1440,height:950}});
  restored.on('pageerror',e=>pageErrors.push(e.message));
  try{await restored.goto(p.url());await restored.waitForSelector('body[data-view-ready=true]');await settle(restored);
   assert.equal(await restored.locator('#sort-key').inputValue(),'year');assert.equal(await restored.locator('#attribute-lens').inputValue(),'year');
   assert.deepEqual(await geometry(restored),sorted);
   await restored.locator('.facet-heading[data-attribute=genre]').hover();await settle(restored);
   const legend=await restored.locator('.attribute-legend').innerText();assert.match(legend,/Release year|year/);assert.match(legend,/sort/i);
   await restored.locator('#search').hover();await settle(restored);
   assert.equal(await restored.locator('#canvas').getAttribute('data-brush-key'),'year');
  }finally{await restored.close();}
 }finally{await p.close();}
});

test('attribute controls remain on screen at narrow widths and heading activation pins',async()=>{
 const p=await open(700);try{
  await p.locator('.facet-heading[data-attribute=year]').focus();await p.keyboard.press('Enter');await p.locator('#search').hover();await settle(p);
  assert.equal(await p.locator('#attribute-lens').inputValue(),'year');
  for(const selector of ['#sort-key','#sort-direction','#attribute-lens']){const box=await p.locator(selector).boundingBox();assert(box&&box.x>=0&&box.x+box.width<=701,JSON.stringify({selector,box}));}
  const bar=await p.locator('.bar').boundingBox(),stage=await p.locator('#stage').boundingBox();assert(stage.y>=bar.height-1);
  await p.keyboard.press('Escape');await settle(p);assert.equal(await p.locator('#attribute-lens').inputValue(),'none');
 }finally{await p.close();}
});

test('facet chips report current and available record populations with the same fill denominator',async()=>{
 const p=await open();try{
  // Unscoped every share is 1 by definition, so nothing is drawn.
  assert.equal(await p.locator('.chip[data-share]').count(),0,'no fill without a scope');

  // Jazz is i%3===0, which is also exactly complexity "low", split evenly
  // across sources. That makes every expected share checkable by hand.
  await p.locator('.chip[data-facet=genre][data-value=Jazz]').click();await settle(p);
  const share=async(facet,value)=>p.locator(`.chip[data-facet=${facet}][data-value=${value}]`).evaluate(el=>({
    share:Number(Number(el.style.getPropertyValue('--share')).toFixed(3)), state:el.dataset.share,
    total:el.dataset.total, available:el.dataset.available, inView:el.dataset.inView, aria:el.getAttribute('aria-label')}));

  assert.deepEqual(await share('complexity','low'),
    {share:1,state:'all',total:'12',available:'12',inView:'12',aria:'low, 12 in view, 12 available with other filters, 12 in the collection. Add complexity filter.'},'every low clip is a Jazz clip');
  assert.deepEqual(await share('complexity','medium'),
    {share:0,state:'none',total:'12',available:'0',inView:'0',aria:'medium, 0 in view, 0 available with other filters, 12 in the collection. Add complexity filter.'},'no medium clip is available under the Jazz filter');
  assert.deepEqual(await share('complexity','high'),
    {share:0,state:'none',total:'12',available:'0',inView:'0',aria:'high, 0 in view, 0 available with other filters, 12 in the collection. Add complexity filter.'});
  assert.deepEqual(await share('source','A'),
    {share:1,state:'all',total:'18',available:'6',inView:'6',aria:'A, 6 in view, 6 available with other filters, 18 in the collection. Add source filter.'},'all six source A records available under Jazz are in view');
  assert.deepEqual(await share('source','B'),
    {share:1,state:'all',total:'18',available:'6',inView:'6',aria:'B, 6 in view, 6 available with other filters, 18 in the collection. Add source filter.'});
  assert.deepEqual(await share('genre','Rock'),
    {share:0,state:'none',total:'24',available:'24',inView:'0',aria:'Rock, 0 in view, 24 available with other filters, 24 in the collection. Add genre filter.'},'own-facet alternatives remain available even when another genre is selected');

  // The fill is decoration over the chip's own ground, never a replacement for
  // it: the background COLOUR must survive so the measured contrast holds.
  const painted=await p.locator('.chip[data-facet=source][data-value=A]').evaluate(el=>{
    const cs=getComputedStyle(el);return{image:cs.backgroundImage,color:cs.backgroundColor};});
  assert.match(painted.image,/linear-gradient/,'the share is painted');
  assert.equal(painted.color,'rgb(20, 20, 31)','--panel-2 still backs the text');

  // Clearing the scope puts the rail back to plain chips.
  await p.locator('.chip[data-facet=genre][data-value=Jazz]').click();await settle(p);
  assert.equal(await p.locator('.chip[data-share]').count(),0,'fills go away with the scope');
 }finally{await p.close();}
});
