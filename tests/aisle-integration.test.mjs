import assert from 'node:assert/strict';
import {test,before,after,afterEach} from 'node:test';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {chromium} from 'playwright';
const clips=Array.from({length:80},(_,i)=>({id:`a${i}`,url:`urn:album:${i}`,title:`Album ${String(i).padStart(2,'0')}`,source:'Fixture',tags:[],captured:i<40?'2025-01-14':'2025-02-20',cover:i===79?'':`/covers/${i%2}.svg`,props:{decade:[i<40?'1970s':'1990s',...(i===0?['1990s']:[])],genre:[i%3?'Rock':'Jazz'],year:[String(1970+i)],dims:['128x128']}}));
const facets={};for(const clip of clips)for(const [key,values] of Object.entries(clip.props))for(const value of values){facets[key]??={};facets[key][value]=(facets[key][value]||0)+1;}
facets.captured={'2025-01':40,'2025-02':40};
let browser,server,origin;let errors=[],writes=[];
before(async()=>{server=createServer(async(req,res)=>{const url=new URL(req.url,'http://fixture');
 if(req.method!=='GET')writes.push([req.method,url.pathname]);
 if(url.pathname==='/api/clips'){res.setHeader('content-type','application/json');res.end(JSON.stringify({clips,facets,corpus:{id:'aisle-fixture',revision:'r1'},ui:{title:'Aisle fixture',defaultGroup:'decade'}}));return;}
 if(url.pathname==='/api/view-state'){res.setHeader('content-type','application/json');res.end(JSON.stringify({version:1,mode:'mountain',groupKey:'decade',piles:[]}));return;}
 if(url.pathname.startsWith('/covers/')){res.setHeader('content-type','image/svg+xml');res.end(`<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128"><rect width="128" height="128" fill="${url.pathname.includes('0')?'#dc4422':'#2f85ef'}"/></svg>`);return;}
 if(url.pathname==='/'||/^\/wall\/[\w./-]+$/.test(url.pathname)&&!url.pathname.includes('..')){try{const file=url.pathname==='/'?'index.html':url.pathname.slice(1);res.setHeader('content-type',file.endsWith('.html')?'text/html':file.endsWith('.css')?'text/css':'text/javascript');res.end(await readFile(new URL('../'+file,import.meta.url)));return;}catch{}}
 res.writeHead(404);res.end();});await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});origin=`http://127.0.0.1:${server.address().port}`;browser=await chromium.launch();});
after(async()=>{await browser?.close();await new Promise(r=>server?.close(r));});
afterEach(()=>{assert.deepEqual(errors.splice(0),[]);assert.equal(writes.splice(0).some(([,p])=>p==='/api/view-state'),false,'aisle never writes mutable pile state');});
const debug=p=>p.evaluate(()=>window.wunderkammerAisleDebug());
async function open(query='?view=aisle&group=decade&rail=0',mobile=false){const p=await browser.newPage({viewport:{width:mobile?390:1440,height:mobile?844:1000},isMobile:mobile,hasTouch:mobile,reducedMotion:'reduce'});p.on('pageerror',e=>errors.push(e.message));await p.goto(query.startsWith('http')?query:origin+'/'+query);await p.waitForSelector('body[data-view-ready=true]');return p;}
const settled=p=>p.waitForTimeout(450);

test('aisle uses canonical groups, value highlighting and scope without sampling members',async()=>{const p=await open('?view=aisle&group=decade&highlight.genre=Jazz&rail=0');try{
 const a=await debug(p);assert.equal(a.mode,'aisle');assert.equal(a.scopeKeys.length,80);assert.equal(a.scene.totalTiles,81);assert.deepEqual(a.view.ui.highlight,{key:'genre',value:'Jazz'});assert.equal(a.scene.lensMatchKeys.length,27);assert.equal(a.scene.cohorts.length,2);
 assert.deepEqual(a.scene.cohorts.map(c=>[c.key,c.count]),[['1990s',41],['1970s',40]]);
 const before=await debug(p);await p.selectOption('#lens-value','Rock');await settled(p);const rock=await debug(p);
 assert.deepEqual(rock.scopeKeys,before.scopeKeys);assert.equal(rock.scene.lensMatchKeys.length,53);assert.deepEqual(rock.scene.state.position,before.scene.state.position);
 await p.locator('#toggle-rail').click();await p.locator('.chip[data-facet=genre][data-value=Jazz]').hover();const preview=await debug(p);assert.equal(preview.scene.lensMatchKeys.length,27);assert.equal(preview.view.ui.highlight.value,'Rock');
 await p.locator('#search').hover();assert.equal((await debug(p)).scene.lensMatchKeys.length,53);
 await p.locator('.chip[data-facet=genre][data-value=Jazz]').click();await p.waitForFunction(()=>window.wunderkammerAisleDebug().scopeKeys.length===27);
 assert.equal((await debug(p)).scene.itemCount,27);
 }finally{await p.close();}});

test('aisle exact picking and keyboard item inspection share the existing detail pane',async()=>{const p=await open();try{
 await p.waitForFunction(()=>window.wunderkammerAisleDebug().scene.pickTargets.length>0);
 const s=await debug(p),hit=s.scene.pickTargets[0],r=await p.locator('.aisle-canvas').boundingBox();
 await p.mouse.click(r.x+(hit.x+1)*r.width/2,r.y+(1-hit.y)*r.height/2);await p.waitForSelector('#detail.open');assert.equal((await debug(p)).view.ui.focus,hit.key);
 await p.keyboard.press('Escape');await p.waitForSelector('#detail.open',{state:'hidden'});
 // No item dropdown: the scene is the keyboard path. ] steps to the next item in aisle order, a live
 // readout names it, and Enter opens it.
 assert.equal(await p.getByText(/Choose an item/).count(),0,'no item dropdown');assert.equal(await p.getByRole('button',{name:'Inspect',exact:true}).count(),0,'no Inspect button');
 await p.locator('.aisle-canvas').focus();await p.keyboard.press(']');const stepped=(await debug(p)).scene.selection;assert.ok(stepped&&stepped!==hit.key,'] steps to another item');
 const readout=p.locator('.aisle-readout');assert.equal(await readout.getAttribute('aria-live'),'polite');assert.ok((await readout.boundingBox()).width<=1,'the readout is a live region nobody sees');
 assert.match(await readout.textContent(),/ · \d+ of \d+ · Enter opens$/);
 await p.keyboard.press('Enter');await p.waitForSelector('#detail.open');assert.equal((await debug(p)).view.ui.focus,stepped,'Enter opens the stepped-to item');
 }finally{await p.close();}});

test('aisle sort, travel, camera and pin survive fresh exact links and flat round trips',async()=>{const p=await open('?view=aisle&group=decade&highlight.genre=Jazz&rail=0');let fresh;try{
 await p.selectOption('#sort-key','title');await p.locator('#sort-direction').click();
 const sorted=await debug(p);assert.equal(sorted.scene.cohorts[0].keys[0],'urn:album:79');
 await p.locator('.aisle-travel input').fill('0.55');await p.locator('.aisle-canvas').focus();await p.keyboard.press('ArrowRight');await settled(p);const saved=await debug(p);fresh=await open(p.url());const restored=await debug(fresh);
 assert.deepEqual(restored.scopeKeys,saved.scopeKeys);assert.deepEqual(restored.view.ui.highlight,saved.view.ui.highlight);assert.deepEqual(restored.view.aisle,saved.view.aisle);
 await p.locator('#view-aisle').click();assert.equal((await debug(p)).mode,'flat');assert.equal(await p.locator('.tile.brush-match').count(),28);await p.locator('#view-aisle').click();assert.equal((await debug(p)).mode,'aisle');assert.deepEqual((await debug(p)).scopeKeys,saved.scopeKeys);
 }finally{await fresh?.close();await p.close();}});

test('phone scope recovery and live-link clipboard preserve the current view',async()=>{const p=await open('?view=aisle&group=decade&highlight.genre=Jazz',true);try{
 await p.context().grantPermissions(['clipboard-read','clipboard-write']);
 await p.locator('#copy-live-view').click();const live=await p.evaluate(()=>navigator.clipboard.readText());assert.equal(new URL(live).hash,'');assert.equal(new URL(live).searchParams.get('highlight.genre'),'Jazz');
 await p.fill('#search','unfindable-value');await p.waitForFunction(()=>window.wunderkammerAisleDebug().scopeKeys.length===0);assert.equal((await debug(p)).scene.totalTiles,0);
 await p.fill('#search','');await p.waitForFunction(()=>window.wunderkammerAisleDebug().scopeKeys.length===80);
 assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 assert.equal(await p.locator('#lens-value').isVisible(),true);
 }finally{await p.close();}});

test('captured value pins use canonical months and leave membership unchanged',async()=>{const p=await open();try{
 await settled(p);const before=await debug(p),stage=await p.locator('#stage').boundingBox();
 await p.selectOption('#attribute-lens','captured');
 await settled(p);assert.deepEqual(await p.locator('#stage').boundingBox(),stage);assert.deepEqual((await debug(p)).view.aisle,before.view.aisle,'pinning a lens never refits the camera');
 assert.deepEqual(await p.locator('#lens-value option').evaluateAll(nodes=>nodes.map(n=>n.value)),['','2025-01','2025-02']);
 await p.selectOption('#lens-value','2025-01');const d=await debug(p);assert.equal(d.scopeKeys.length,80);assert.equal(d.scene.lensMatchKeys.length,40);
 }finally{await p.close();}});

test('restoring flat history retains a hidden aisle snapshot until its scope is installed',async()=>{const p=await open();try{
 await p.locator('.aisle-canvas').focus();await p.keyboard.press(']');const chosen=(await debug(p)).scene.selection;assert.ok(chosen);await p.locator('#view-aisle').click();await settled(p);
 const savedURL=p.url(),saved=(await debug(p)).view.aisle;
 await p.fill('#search','Album 70');await p.waitForFunction(()=>window.wunderkammerAisleDebug().scopeKeys.length===1);await p.locator('#view-aisle').click();
 assert.equal((await debug(p)).scene.itemCount,1);
 await p.evaluate(url=>{history.pushState({},'',url);dispatchEvent(new PopStateEvent('popstate'));},savedURL);
 await p.waitForFunction(()=>window.wunderkammerAisleDebug().mode==='flat'&&!document.body.dataset.restoring);
 assert.deepEqual((await debug(p)).view.aisle,saved);
 await p.locator('#view-aisle').click();const restored=await debug(p);assert.equal(restored.scene.itemCount,80);assert.equal(restored.view.aisle.selection,chosen);
 }finally{await p.close();}});

test('live grouped 3D intent retains piles and clean view switches retain the camera',async()=>{const p=await open('?view=3d&group=decade&rail=0');try{
 const start=await debug(p);assert.equal(start.view.spatial.mode,'piles');assert.equal(start.view.spatial.arrangement.piles.length,2);
 await p.locator('#zoom-in').click();await p.waitForTimeout(350);const camera=(await debug(p)).view.spatial;
 await p.locator('#view-3d').click();await p.locator('#view-3d').click();await p.waitForTimeout(350);
 const restored=(await debug(p)).view.spatial;assert.deepEqual(restored.position,camera.position);assert.deepEqual(restored.target,camera.target);
 }finally{await p.close();}});

test('an exact saved mountain view is authoritative even with a facet grouping',async()=>{const p=await open('?view=3d&group=decade&rail=0');let fresh;try{
 const url=await p.evaluate(async()=>{
  const {encodeView}=await import('/wall/permalink.mjs');const view=window.wunderkammerAisleDebug().view;
  view.spatial.mode='mountain';view.spatial.arrangement.piles=[];view.spatial.spread=-1;view.spatial.fitted=true;
  return location.origin+'/?view=3d&group=decade#v=1&s='+encodeView(view);
 });fresh=await open(url);assert.equal((await debug(fresh)).view.spatial.mode,'mountain');
 }finally{await fresh?.close();await p.close();}});

test('without 3D graphics the aisle offers the flat wall',async()=>{const p=await open();try{
 await p.evaluate(()=>document.querySelector('.aisle-canvas').getContext('webgl2').getExtension('WEBGL_lose_context').loseContext());
 const status=p.locator('.aisle-status');await status.locator('.view-fallback').waitFor();
 assert.match(await status.textContent(),/^3D graphics are unavailable here\. Show the flat wall$/);
 await status.locator('.view-fallback').click();await p.waitForFunction(()=>document.body.dataset.viewMode==='flat');
 }finally{await p.close();}});
