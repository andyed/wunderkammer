#!/usr/bin/env node
/** Read-only live proof. An explicit target avoids touching the wrong instance. */
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {chromium} from 'playwright';
const target=process.env.WUNDERKAMMER_URL;
if(!target)throw new Error('Set WUNDERKAMMER_URL to the verified main wall URL, including any intended query parameters.');
const out=path.resolve(process.env.AISLE_PROOF_DIR||'.local/aisle-integration/proof');await mkdir(out,{recursive:true});
const browser=await chromium.launch();const errors=[],writes=[],requests=[],report={target};
const debug=p=>p.evaluate(()=>window.wunderkammerAisleDebug());
const ready=async p=>{await p.waitForSelector('body[data-view-ready=true]');await p.waitForFunction(()=>window.wunderkammerAisleDebug().mode==='aisle'&&window.wunderkammerAisleDebug().scene?.renderCount>0);};
const loaded=async p=>p.waitForFunction(()=>{const s=window.wunderkammerAisleDebug().scene;return s.loadedArtwork+s.failedArtwork===s.itemCount;},null,{timeout:90000});
function listen(p){p.on('pageerror',e=>errors.push(e.message));p.on('request',r=>{requests.push(r.url());if(r.method()==='PUT')writes.push(r.url());});p.on('console',m=>{if(m.type()==='error'&&/THREE|WebGL|shader/i.test(m.text()))errors.push(m.text());});}
try{
 const context=await browser.newContext({viewport:{width:1600,height:1050},permissions:['clipboard-read','clipboard-write'],reducedMotion:'reduce'});
 const page=await context.newPage();listen(page);await page.goto(target);await ready(page);await loaded(page);
 const initial=await debug(page);assert(initial.scene.loadedArtwork>0);assert.equal(initial.scene.totalTiles,initial.scene.cohorts.reduce((n,c)=>n+c.count,0));assert(initial.scene.pickTargets.length);
 report.initial={items:initial.scene.itemCount,appearances:initial.scene.totalTiles,loaded:initial.scene.loadedArtwork,failed:initial.scene.failedArtwork,atlasBytes:initial.scene.atlasBytes,cohorts:initial.scene.cohorts.map(c=>({key:c.key,count:c.count}))};
 report.textContrast=await page.evaluate(()=>{
  const rgba=s=>s.match(/[\d.]+/g).map(Number),lum=c=>c.slice(0,3).map(v=>v/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((n,v,i)=>n+v*[.2126,.7152,.0722][i],0);
  return [...document.querySelectorAll('.aisle-cohort-label,.aisle-toolbar label,.aisle-toolbar select,.aisle-toolbar button,.aisle-help')].filter(e=>e.getBoundingClientRect().width).map(e=>{
   const fg=rgba(getComputedStyle(e).color);let node=e,bg;
   while(node){const c=rgba(getComputedStyle(node).backgroundColor);if(c.length===3||c[3]>0){bg=c;break;}node=node.parentElement;}
   // Worst-case white artwork behind the translucent overlay.
   const a=bg?.[3]??1,paint=(bg||[255,255,255]).slice(0,3).map(v=>v*a+255*(1-a));
   return {element:e.className||e.tagName,ratio:(lum(fg)+.05)/(lum(paint)+.05)};
  });
 });
 assert(report.textContrast.every(c=>c.ratio>=8),JSON.stringify(report.textContrast));
 await page.screenshot({path:path.join(out,'aisle.png')});
 const hit=initial.scene.pickTargets.find(h=>h.y<.5&&h.y>-.4)||initial.scene.pickTargets[0],box=await page.locator('.aisle-canvas').boundingBox();
 await page.mouse.click(box.x+(hit.x+1)*box.width/2,box.y+(1-hit.y)*box.height/2);await page.waitForSelector('#detail.open');assert.equal((await debug(page)).view.ui.focus,hit.key);report.exactCoverPick=true;
 await page.keyboard.press('Escape');await page.waitForSelector('#detail.open',{state:'hidden'});
 const lens=await page.locator('#attribute-lens option').evaluateAll(nodes=>nodes.find(n=>n.value==='genre')?.value||nodes.find(n=>n.value!=='none'&&n.value!=='title')?.value);
 await page.selectOption('#attribute-lens',lens);const value=await page.locator('#lens-value option').nth(1).getAttribute('value');await page.selectOption('#lens-value',value);await page.mouse.move(0,0);
 const highlighted=await debug(page);assert.deepEqual(highlighted.scopeKeys,initial.scopeKeys);assert(highlighted.scene.lensMatchKeys.length>0);assert.equal(highlighted.view.ui.highlight.value,value);
 await page.locator('.aisle-travel input').fill('0.45');await page.locator('.aisle-canvas').focus();await page.keyboard.press('ArrowLeft');
 await page.getByRole('button',{name:'Copy link',exact:true}).click();const exact=await page.evaluate(()=>navigator.clipboard.readText()),saved=await debug(page);
 const fresh=await context.newPage();listen(fresh);await fresh.goto(exact);await ready(fresh);const restored=await debug(fresh);assert.deepEqual(restored.view.aisle,saved.view.aisle);assert.deepEqual(restored.view.ui.highlight,saved.view.ui.highlight);assert.deepEqual(restored.scopeKeys,saved.scopeKeys);await fresh.close();report.exactRestoration=true;
 await page.getByRole('button',{name:'Copy live view link',exact:true}).click();const live=await page.evaluate(()=>navigator.clipboard.readText());assert.equal(new URL(live).hash,'');assert.equal(new URL(live).searchParams.get('view'),'aisle');assert.equal(new URL(live).searchParams.get(`highlight.${lens}`),value);report.liveURL=live;
 await page.screenshot({path:path.join(out,'highlight.png')});
 const phone=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true,reducedMotion:'reduce'});listen(phone);await phone.goto(live);await ready(phone);await loaded(phone);
 const phoneData=await debug(phone);assert.deepEqual(phoneData.scopeKeys,saved.scopeKeys);assert.equal(await phone.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 // A tap on a cover is the phone's way in; there is no item dropdown.
 const tapHit=phoneData.scene.pickTargets.find(h=>h.y<.5&&h.y>-.4)||phoneData.scene.pickTargets[0],phoneBox=await phone.locator('.aisle-canvas').boundingBox();
 await phone.touchscreen.tap(phoneBox.x+(tapHit.x+1)*phoneBox.width/2,phoneBox.y+(1-tapHit.y)*phoneBox.height/2);await phone.waitForSelector('#detail.open');assert.equal((await debug(phone)).view.ui.focus,tapHit.key);
 // Clearing a lens is one Escape layer, then the owning detail pane closes.
 await phone.keyboard.press('Escape');if(await phone.locator('#detail.open').count())await phone.keyboard.press('Escape');
 await phone.screenshot({path:path.join(out,'phone.png')});report.phone=true;
 assert.equal(requests.some(url=>/comparison-(app|scene|model)\.mjs|compare\.html/.test(url)),false,'main wall does not load comparison workbench');
 assert.deepEqual(writes,[],'aisle never mutates saved piles');assert.deepEqual(errors,[]);report.errors=errors;
 await writeFile(path.join(out,'verification.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({passed:true,proof:out,...report.initial,restored:true,phone:true,liveURL:live}));
}finally{await browser.close();}
