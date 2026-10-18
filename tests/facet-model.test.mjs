import test from 'node:test';
import assert from 'node:assert/strict';
import { buildFacetModel, selectFacetValues } from '../wall/facet-model.mjs';
import { filterScope, matchesFacet } from '../wall/context-clusters.mjs';

const clips = [
  { id:'a', url:'urn:a', title:'Quiet river', note:'warm jazz', source:'vault', tags:['jazz','jazz'], captured:['2026-01-10','2026-02-15'], props:{color:['red','red','blue']} },
  { id:'b', url:'urn:b', title:'Quiet mountain', note:'cold', source:'vault', tags:['ambient'], captured:'2026-02-10', props:{color:'blue'} },
  { id:'c', url:'urn:c', title:'Loud river', source:'web', tags:['jazz'], captured:'2025-12-12', props:{color:'red'} },
  { id:'d', url:'urn:d', title:'Quiet shoreline', source:'vault', tags:['jazz','ambient'], captured:'2026-03-10', props:{color:'green'} },
  { id:'e', url:'urn:e', title:'Bright canyon', source:'vault', tags:['rock'], captured:null, props:{color:'red'} },
  { id:'f', url:'urn:f', title:'Quiet plain', source:'web', tags:['jazz'], captured:'2027-01-01', color:'green', props:{color:'blue'} },
];
const keys = ['color','source','tags','captured'];
const active = (...entries) => new Map(entries.map(([key, values])=>[key,new Set(values)]));
const row = (model,key,value) => model.get(key).values.find(row=>row.value===value);
const numbers = item => ({total:item.total,inView:item.inView,available:item.available});

// Expected counts below come directly from the six-record fixture, not the model.
test('contextual availability omits only its own facet and respects OR within, AND across',()=>{
  const scope={query:'',active:active(['color',['red','blue']],['source',['vault']]),branches:null};
  const model=buildFacetModel(clips,scope,{keys});
  assert.equal(model.get('color').inView,3); // a,b,e
  assert.equal(model.get('color').available,4); // a,b,d,e; color omitted
  assert.deepEqual(numbers(row(model,'color','red')),{total:3,inView:2,available:2});
  assert.deepEqual(numbers(row(model,'color','blue')),{total:2,inView:2,available:2});
  assert.deepEqual(numbers(row(model,'color','green')),{total:2,inView:0,available:1});
  assert.deepEqual(numbers(row(model,'source','web')),{total:2,inView:0,available:1}); // c
  assert.deepEqual(numbers(row(model,'tags','ambient')),{total:2,inView:1,available:1}); // b
  assert.equal(row(model,'color','red').active,true);
  assert.equal(row(model,'color','green').active,false);
  assert.deepEqual(filterScope(clips,scope).map(c=>c.id),['a','b','e']);
});

test('duplicate multivalues count a clip once and top-level values retain canonical precedence',()=>{
  const model=buildFacetModel(clips,{}, {keys});
  assert.equal(row(model,'color','red').total,3);
  assert.equal(row(model,'tags','jazz').total,4);
  assert.equal(row(model,'color','blue').total,2,'f has top-level green, not props blue');
  assert.equal(row(model,'captured','2026-01').total,1);
  assert.equal(row(model,'captured','2026-02').total,2);
});

test('text terms and frozen union branches constrain every available count',()=>{
  const scope={query:'QUIET jazz',active:active(['color',['red']]),branches:[
    {label:'First',keys:['urn:a','urn:b']},{label:'Second',keys:['urn:a','urn:d','urn:e']},
  ]};
  const model=buildFacetModel(clips,scope,{keys});
  assert.equal(model.get('color').inView,1); // a
  assert.equal(model.get('color').available,2); // a,d
  assert.deepEqual(numbers(row(model,'color','green')),{total:2,inView:0,available:1});
  assert.deepEqual(numbers(row(model,'tags','jazz')),{total:4,inView:1,available:1});
  assert.deepEqual(numbers(row(model,'source','web')),{total:2,inView:0,available:0});
  assert.deepEqual(filterScope(clips,scope).map(c=>c.id),['a']);
  const empty=buildFacetModel(clips,{...scope,branches:[]},{keys});
  assert.ok([...empty.values()].every(f=>f.inView===0&&f.available===0));
  assert.ok([...empty.values()].every(f=>f.values.every(r=>r.inView===0&&r.available===0)));
  assert.equal(row(empty,'color','red').total,3);
});

test('captured prefix counts cover restored years without double-counting multiple months',()=>{
  const scope={query:'',active:active(['captured',['2026','2026-0','2026-01-10','2099']]),branches:null};
  const model=buildFacetModel(clips,scope,{keys,catalog:{captured:{'2025':999,'2026-02':999}}});
  assert.deepEqual(numbers(row(model,'captured','2026')),{total:3,inView:3,available:3}); // a,b,d
  assert.deepEqual(numbers(row(model,'captured','2026-0')),{total:3,inView:3,available:3});
  assert.deepEqual(numbers(row(model,'captured','2025')),{total:1,inView:0,available:1});
  assert.deepEqual(numbers(row(model,'captured','2026-02')),{total:2,inView:2,available:2});
  assert.deepEqual(numbers(row(model,'captured','2026-01-10')),{total:0,inView:0,available:0},'canonical valuesOf normalizes to month before prefix matching');
  assert.equal(row(model,'captured','2099').active,true);
  assert.equal(row(model,'captured','2099').total,0);
  assert.equal(model.get('captured').available,6,'scope count includes records without a captured value');
  assert.equal(matchesFacet(clips[0],'captured',new Set(['2026'])),true);
  assert.equal(matchesFacet(clips[0],'captured',new Set(['2026-01-10'])),false);
});

test('unknown restored selections stay removable and catalog metadata does not invent counts',()=>{
  const scope={query:'',active:active(['color',['ultraviolet']]),branches:null};
  const model=buildFacetModel(clips,scope,{keys,catalog:{color:{red:9000,ghost:777}}});
  assert.deepEqual(numbers(row(model,'color','ultraviolet')),{total:0,inView:0,available:0});
  assert.equal(row(model,'color','ultraviolet').active,true);
  assert.deepEqual(numbers(row(model,'color','ghost')),{total:0,inView:0,available:0});
  assert.deepEqual(numbers(row(model,'color','red')),{total:3,inView:0,available:3});
  assert.equal(model.get('color').available,6);
  assert.equal(model.get('source').available,0,'other unknown facet remains a constraint');
  assert.deepEqual(selectFacetValues(model.get('color'),{search:'red',limit:1}).values.map(r=>r.value),['red','ultraviolet']);
});

test('hidden facet presentation is caller policy while hidden active constraints remain authoritative',()=>{
  const model=buildFacetModel(clips,{active:active(['source',['web']])},{keys:['color']});
  assert.deepEqual([...model.keys()],['color']);
  assert.equal(model.get('color').inView,2);
  assert.deepEqual(numbers(row(model,'color','red')),{total:3,inView:1,available:1});
  const defaults=buildFacetModel(clips,{active:active(['captured',['2026']])},{catalog:{color:{red:3}}});
  assert.deepEqual([...defaults.keys()],['color','captured']);
});

test('stable ordering and local value search retain active tail values and support progressive limits',()=>{
  const many=Array.from({length:40},(_,i)=>({id:String(i),url:`urn:${i}`,title:'Unrelated record',props:{artist:`Artist ${String(i).padStart(2,'0')}`}}));
  const scope={query:'',active:active(['artist',['Artist 39','Unknown']]),branches:null};
  const model=buildFacetModel(many,scope,{keys:['artist']});
  const facet=model.get('artist');
  const page=selectFacetValues(facet);
  assert.equal(page.values.length,26);
  assert.equal(page.hiddenCount,15);
  assert.equal(page.totalCount,41);
  assert.ok(page.values.some(r=>r.value==='Artist 39'&&r.active));
  assert.ok(page.values.some(r=>r.value==='Unknown'&&r.active));
  const searched=selectFacetValues(facet,{search:'ARTIST 3',limit:24});
  assert.equal(searched.matchingCount,13);
  assert.equal(searched.values.length,14);
  assert.equal(searched.retainedActiveCount,1);
  assert.equal(searched.hiddenCount,0);
  assert.equal(scope.query,'');
  assert.equal(selectFacetValues(facet,{search:'Unrelated record'}).matchingCount,0,'facet search never searches record titles');
  assert.equal(selectFacetValues(facet,{limit:48}).values.length,41);
  assert.equal(selectFacetValues(facet,{limit:Infinity}).hiddenCount,0);
  assert.deepEqual(buildFacetModel(many,{}, {keys:['artist']}).get('artist').values.map(r=>r.value),facet.values.filter(r=>r.value!=='Unknown').map(r=>r.value));
});

test('date/year and period display orders preserve the existing rail grammar',()=>{
  const sample=[{id:'a',props:{year:'1999',publication_period:'B'}},{id:'b',props:{year:'2026',publication_period:'A'}}];
  const model=buildFacetModel(sample,{}, {keys:['year','publication_period']});
  assert.deepEqual(model.get('year').values.map(r=>r.value),['2026','1999']);
  assert.deepEqual(model.get('publication_period').values.map(r=>r.value),['A','B']);
});

test('absent adapter strings do not invent blank facet choices but restored values remain removable',()=>{
  const items=[{url:'urn:dated',captured:'2026-03-01',props:{artist:'Known'}},{url:'urn:missing',captured:'',props:{artist:''}}];
  const options={keys:['captured','artist']};
  const model=buildFacetModel(items,{},options);
  assert.deepEqual(model.get('captured').values.map(r=>r.value),['2026-03']);
  assert.deepEqual(model.get('artist').values.map(r=>r.value),['Known']);
  const restored=buildFacetModel(items,{active:active(['artist',['']])},options);
  assert.deepEqual(row(restored,'artist',''),{value:'',total:1,inView:1,available:1,active:true});
});

test('empty corpus, empty active sets and inputs remain intact',()=>{
  const selected=active(['color',[]]);
  const before=JSON.stringify(clips);
  const model=buildFacetModel(clips,{active:selected},{keys});
  assert.equal(model.get('color').inView,6);
  assert.equal(JSON.stringify(clips),before);
  assert.equal(selected.get('color').size,0);
  const empty=buildFacetModel([],{active:active(['color',['missing']])},{keys:['color']});
  assert.deepEqual(empty.get('color'),{key:'color',scoped:true,total:0,inView:0,available:0,values:[{value:'missing',total:0,inView:0,available:0,active:true}]});
});


test('scoped status distinguishes an empty union from an unconstrained collection',()=>{
  assert.equal(buildFacetModel(clips,{}, {keys}).scoped,false);
  assert.equal(buildFacetModel(clips,{}, {keys}).get('color').scoped,false);
  assert.equal(buildFacetModel(clips,{query:'  ',active:active(['color',[]])},{keys}).scoped,false);
  assert.equal(buildFacetModel(clips,{query:'river'},{keys}).scoped,true);
  assert.equal(buildFacetModel(clips,{active:active(['color',['red']])},{keys}).scoped,true);
  assert.equal(buildFacetModel(clips,{branches:[]},{keys}).scoped,true);
  assert.equal(buildFacetModel(clips,{branches:[]},{keys}).get('color').scoped,true);
});

test('bucket counting does not reread every clip for each catalog value',()=>{
  let reads=0;
  const many=Array.from({length:200},(_,i)=>({id:String(i),url:`urn:${i}`,title:'Item',props:{get color(){reads++;return `value-${i}`;}}}));
  const model=buildFacetModel(many,{}, {keys:['color']});
  assert.equal(model.get('color').values.length,200);
  assert.equal(reads,200,'one valuesOf read per clip for this facet, not one per candidate');
});

test('count optimization agrees with canonical scope evaluation over varied facet combinations',()=>{
  let seed=0x5f3b;
  const random=()=>{seed=(1664525*seed+1013904223)>>>0;return seed/2**32;};
  const colors=['red','green','blue'];
  for(let trial=0;trial<24;trial++){
    const sample=Array.from({length:20},(_,i)=>({id:String(i),url:`urn:${i}`,title:i%2?'Moon valley':'Sun river',source:i%3?'vault':'web',tags:i%4?['jazz']:['rock'],captured:i%5?'2026-01-10':'2025-12-10',props:{color:[colors[i%3],colors[(i+1)%3]]}}));
    const scope={query:random()<.5?'moon':'',active:active(['color',colors.filter(()=>random()<.5)],['source',['vault','web'].filter(()=>random()<.5)],['captured',random()<.5?['2026']:[]]),branches:trial%3===0?[]:trial%3===1?null:[{label:'Frozen',keys:sample.filter(()=>random()<.6).map(c=>c.url)}]};
    const model=buildFacetModel(sample,scope,{keys});
    const current=filterScope(sample,scope);
    for(const [key,facet] of model){
      const remaining=new Map(scope.active);remaining.delete(key);
      const eligible=filterScope(sample,{...scope,active:remaining});
      assert.equal(facet.inView,current.length);
      assert.equal(facet.available,eligible.length);
      for(const entry of facet.values){
        const member=clip=>matchesFacet(clip,key,new Set([entry.value]));
        assert.equal(entry.total,sample.filter(member).length);
        assert.equal(entry.inView,current.filter(member).length);
        assert.equal(entry.available,eligible.filter(member).length);
      }
    }
  }
});
