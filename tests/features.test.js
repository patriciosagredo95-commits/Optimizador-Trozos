import {formatPercent} from '../dist/format.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import * as optimizer from '../dist/optimizer.js';
import * as reports from '../dist/reports.js';
import * as order from '../dist/order.js';
import * as planner from '../dist/run-planner.js';
import * as armado from '../dist/armado.js';
import {createOptimizer,DIAMETERS,normalizeConfig,CUTTING_DEFAULTS} from '../dist/optimizer.js';
import {configurationFile,parseConfiguration,restoreConfiguration,STORAGE_KEY,resultsCSV,printSheet,stageSVG,cutSequence,historicalComparison,activeProducts} from '../dist/reports.js';

test('vista por etapas: pantalla y ficha comparten resúmenes, agrupación y armados',()=>{
  const engine=createOptimizer(),result=engine.solve(42),sheet=printSheet(result,engine.config);
  const app=readFileSync(new URL('../dist/app.js',import.meta.url),'utf8');
  assert.ok(app.includes("$('stage-explanation').textContent=stageSummary(r,state.stage)"));
  assert.ok(app.includes('stageOutputsHTML(r,state.stage,c)'));
  for(const stage of [0,1,2,3,4])assert.ok(sheet.includes(reports.stageSummary(result,stage)));
  assert.equal((sheet.match(/class="stage-arm-chain"/g)??[]).length,2);
  assert.equal((sheet.match(/data-arm-width=/g)??[]).length,11);
  assert.ok(sheet.includes('Armado: 22 · 22 · 50 · 26 · 26 · 50 · 22 · 22 mm; cada corte 4,2 mm'));
  const final=sheet.split('<section class="print-output">')[0];
  assert.equal((final.match(/<li value=/g)??[]).length,6);
  assert.ok(final.includes('encierra la médula'));
  assert.ok(sheet.includes('No pasan por esta máquina'));
});

test('persistencia v3. Ida y vuelta, migración v2 y descarte de entradas del motor anterior',()=>{
  const config=normalizeConfig({cutting:{m:4},length:6000});
  assert.deepEqual(parseConfiguration(configurationFile(config)),config);
  const old={targets:[{thickness:'bad'}],criterion:'total',recoveries:[],kerfBand:12,margin:15,maxBases:2,largeLog:{...CUTTING_DEFAULTS,m:4},length:6000};
  assert.deepEqual(normalizeConfig(old),config);
  assert.deepEqual(parseConfiguration(JSON.stringify({format:'corte-config',version:1,configuration:old})),config);
  const storage=new Map([['glover-cutting-config-v2',JSON.stringify(old)]]);
  const reader={getItem:key=>storage.get(key)??null};
  assert.deepEqual(restoreConfiguration(reader),config);
  storage.set(STORAGE_KEY,JSON.stringify(normalizeConfig()));
  assert.deepEqual(restoreConfiguration(reader),normalizeConfig());
  assert.deepEqual(restoreConfiguration({getItem:()=>null}),normalizeConfig());
  assert.deepEqual(Object.keys(normalizeConfig(old)),['cutting','length']);
  assert.throws(()=>parseConfiguration('{"format":"bad"}'));
  assert.throws(()=>parseConfiguration('{"format":"corte-config","version":99}'));
  assert.throws(()=>restoreConfiguration({getItem:()=>'{malformed'}));
});
test('formulario único. Campos V2 y ausencia de entradas o rótulos anteriores',()=>{
  const html=readFileSync(new URL('../dist/index.html',import.meta.url),'utf8');
  const app=readFileSync(new URL('../dist/app.js',import.meta.url),'utf8');
  assert.equal((html.match(/<form /g)||[]).length,1);
  for(const id of ['large-x1','large-y1','large-x2','large-y2','large-x3','large-y3','large-med','large-a','large-c','large-m','large-n','large-e1','large-e2','large-cm','large-cw','reference-diameter','length','alternative-grid','historical-inputs','order-total-c'])assert.ok(html.includes(`id="${id}"`),id);
  for(const removed of ['target-a-thickness','target-b-enabled','recovery-inputs','add-recovery','criterion','kerf-band','kerf-gang','kerf-edger','margin','max-bases','min-base-width','max-base-width']){
    assert.ok(!html.includes(`id="${removed}"`),removed);
    assert.ok(!app.includes(`$('${removed}')`),removed);
  }
  assert.ok(!/menores|mayores|hasta 34|desde 36|objetivo [AB]/i.test(html));
  const ids=new Set([...html.matchAll(/id="([^"]+)"/g)].map(match=>match[1]));
  for(const match of app.matchAll(/\$\('([^']+)'\)/g))assert.ok(ids.has(match[1]),match[1]);
});
test('informes uniformes. Etapas, cortes actuales y anteriores, cotas, destinos y selección de alternativa',()=>{
  const engine=createOptimizer();
  for(const d of DIAMETERS){
    const r=engine.solve(d),sequence=cutSequence(r),c=engine.config;
    assert.equal(sequence.carriage.cuts.length,r.cutting.big?3:1);
    assert.ok(sequence.carriage.cuts.every(cut=>cut.kerf===3.4));
    assert.equal(sequence.multiple.groups.length,r.cutting.bodies.length);
    assert.ok(sequence.multiple.groups.every(group=>group.cuts.every(cut=>cut.kerf===4.2)));
    for(let stage=0;stage<=4;stage++){
      const svg=stageSVG(r,c,stage,`test-${d}-${stage}`);
      assert.match(svg,/<svg/);
      assert.match(svg,/data-cut-state="(?:current|previous)"/);
      if(stage>0)assert.match(svg,/data-cut-state="current"/);
      assert.ok(!/NaN|undefined/.test(svg),`${d} stage ${stage}`);
    }
    const sheet=printSheet(r,c);
    for(const label of ['Carro Huincha','Huinchas','Múltiple','Canteadora','Cotas de corte','Centro de sierra','Destino','V_JAS'])assert.ok(sheet.includes(label),`${d} ${label}`);
    assert.equal((sheet.match(/<svg /g)||[]).length,5);
    assert.ok(!/NaN|undefined/.test(sheet));
    assert.ok(printSheet(r.alternatives[1],c,{schemeLabel:'Alternativa 2'}).includes('Alternativa 2'));
  }
});
test('CSV. Catálogo mixto con principal, aprovechamientos, destinos, volumen y cotas',()=>{
  const engine=createOptimizer(),results=DIAMETERS.map(d=>engine.solve(d));
  const csv=resultsCSV(results,engine.config);
  assert.equal(csv.split('\r\n').length,22);
  for(const label of ['Principal','Aprov. 1','Aprov. 2','Destino','dest','V_prod','V_JAS','Cotas carro','Armado y cotas múltiple'])assert.ok(csv.toLowerCase().includes(label.toLowerCase()));
  assert.ok(!/Modelo menor|trozo mayor|undefined|NaN/.test(csv));
});
test('comparación histórica. Catálogo físico para todos los diámetros y validación',()=>{
  const engine=createOptimizer();
  for(const d of DIAMETERS){
    const r=engine.solve(d),ps=activeProducts(engine.config,r),quantities=ps.map(p=>r.counts[p.id].quantity);
    const comparison=historicalComparison(r,engine.config,quantities);
    assert.ok(Math.abs(comparison.deltaVolume)<1e-9);
    assert.ok(Math.abs(comparison.deltaPoints)<1e-7);
    assert.throws(()=>historicalComparison(r,engine.config,quantities.map(()=>0)),/al menos/);
    assert.throws(()=>historicalComparison(r,engine.config,quantities.map(()=>100000)),/área/);
    assert.throws(()=>historicalComparison(r,engine.config,[-1]));
  }
});
test('worker. Entrada normal y resultados de los 21 diámetros con configuración limpia',()=>{
  const source=readFileSync(new URL('../dist/worker.js',import.meta.url),'utf8').replace(/^import[^\n]+\n/gm,'');
  const messages=[],self={postMessage:message=>messages.push(message)};
  vm.runInNewContext(source,{self,createOptimizer,DIAMETERS});
  self.onmessage({data:{runId:7,config:{length:4000,margin:12}}});
  assert.equal(messages[0].type,'ready');
  assert.deepEqual(Object.keys(messages[0].config),['cutting','length']);
  assert.equal(messages.filter(message=>message.type==='result').length,21);
  assert.equal(messages.at(-1).type,'done');
  assert.ok(messages.every(message=>message.runId===7));
  messages.length=0;
  self.onmessage({data:{runId:8,config:{length:0}}});
  assert.equal(messages[0].type,'error');
});
test('Resumen Modelo generado. Método, fórmulas, historial y 21 resultados',()=>{
  const summary=readFileSync(new URL('../Resumen Modelo.md',import.meta.url),'utf8');
  assert.ok(summary.includes('Método general V2'));
  assert.ok(summary.includes('glover-cutting-config-v3'));
  assert.ok(summary.includes('comparación histórica'));
  assert.equal((summary.match(/^\| \d+ \|/gm)||[]).length,21);
});

test('aplicación. Inicio, validación y recálculo por la entrada normal del formulario',async()=>{
  const html=readFileSync(new URL('../dist/index.html',import.meta.url),'utf8');
  const elements=new Map();
  function node(){
    return {value:'',children:[],hidden:false,disabled:false,textContent:'',innerHTML:'',dataset:{},listeners:{},style:{setProperty(){}},classList:{toggle(){}},
      append(...children){this.children.push(...children);},replaceChildren(...children){this.children=[...children];},
      addEventListener(type,listener){this.listeners[type]=listener;},setAttribute(){},hasAttribute(){return false;},
      querySelector(){return node();},querySelectorAll(){return [];},focus(){}};
  }
  for(const match of html.matchAll(/<(?:input|select|[^ >]+)[^>]*id="([^" ]+)"[^>]*>/g)){
    const element=node();
    element.value=match[0].match(/value="([^"]*)"/)?.[1]??'';
    elements.set(match[1],element);
  }
  const document={getElementById(id){assert.ok(elements.has(id),id);return elements.get(id);},querySelector:()=>node(),querySelectorAll:()=>[],createElement:node,createTextNode:value=>value};
  const storage=new Map();
  class Worker{
    postMessage({runId,config}){
      queueMicrotask(()=>{
        const engine=createOptimizer(config);
        this.onmessage({data:{type:'ready',runId,config:engine.config}});
        for(const [index,d] of DIAMETERS.entries())this.onmessage({data:{type:'result',runId,result:engine.solve(d),completed:index+1}});
        this.onmessage({data:{type:'done',runId}});
      });
    }
    terminate(){}
  }
  let source=readFileSync(new URL('../dist/app.js',import.meta.url),'utf8').replace(/^import[^\n]+\n/gm,'');
  source=source.replaceAll('import.meta.url',JSON.stringify('http://localhost/app.js'));
  const context=vm.createContext({...optimizer,...reports,...order,...planner,...armado,formatPercent,document,Worker,URL,AbortController,queueMicrotask,
    window:{addEventListener(){}},localStorage:{getItem:key=>storage.get(key)??null,setItem:(key,value)=>storage.set(key,value)}});
  vm.runInContext(source,context);
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(vm.runInContext('state.results.size',context),21);
  assert.equal(vm.runInContext('state.selected',context),42);
  assert.equal(elements.get('pattern-state').textContent,'Calculado');
  assert.equal(elements.get('yield-value').textContent,formatPercent(vm.runInContext('selectedResult().yield',context)));
  assert.match(elements.get('geometric-value').textContent,/^\d+,\d %$/);
  assert.ok(elements.get('large-result').innerHTML.includes('Destino'));
  elements.get('large-m').value='3';
  await assert.rejects(vm.runInContext('runOptimization()',context),/par/);
  assert.ok(elements.get('form-error').textContent.includes('par'));
  elements.get('large-m').value='2';
  elements.get('length').value='8000';
  await vm.runInContext('runOptimization()',context);
  assert.equal(vm.runInContext('state.snapshot.length',context),8000);
  // A30 a 8 m: el doble del caso §11 A30 (0,20168 m³ a 4 m) con las reglas de planta del 2026-11-09.
  assert.equal(vm.runInContext('state.results.get(30).volume',context),.40336);
  assert.ok(storage.has(STORAGE_KEY));
});

test('descartes. El adaptador conserva secciones físicas y cantidades reales',()=>{
  const engine=createOptimizer({cutting:{x1:55,y1:75,x2:22,y2:75,x3:22,y3:60,a:22,m:4}});
  const r=engine.solve(26).cutting;
  // Reglas de planta del 2026-11-09: solo se descartan piezas de aprovechamiento con canto muerto.
  assert.equal(r.nLost,2);
  assert.equal(r.nLost22,0);
  const discarded=r.prod.filter(row=>row.dest==='Pérdida');
  assert.equal(discarded.reduce((sum,row)=>sum+row.n,0),2);
  assert.ok(discarded.every(row=>!row.sec.startsWith('22 ×')));
  assert.ok(!r.warn.some(([,message])=>message.includes('de 22 mm de la múltiple pierde')));
});

test('porcentajes de pantalla: un decimal, coma decimal y etiquetas compactas',()=>{
  assert.equal(formatPercent(56.53),'56,5 %');
  assert.equal(formatPercent(57),'57,0 %');
  assert.equal(formatPercent(0),'0,0 %');
  assert.equal(formatPercent(38.67),'38,7 %');
  assert.equal(formatPercent(99.96),'100,0 %');
  assert.equal(formatPercent(56.53,true),'57 %');
});

test('alternativas: tablas 75 y 60 sin duplicar principal y conteo completo',()=>{
  const source=readFileSync(new URL('../dist/app.js',import.meta.url),'utf8');
  const rowsFor=vm.runInNewContext(source.slice(source.indexOf('function productionRows('),source.indexOf('function boardCounts('))+';productionRows');
  const result=createOptimizer().solve(42),rows=rowsFor(result);
  assert.equal(rows.find(r=>r.key==='board75').count,12);
  assert.equal(rows.find(r=>r.key==='board60').count,6);
  assert.equal(rows.reduce((sum,r)=>sum+r.count,0),result.pieces.length);
  const principal=createOptimizer({cutting:{x1:22,y1:75}}).solve(42),special=rowsFor(principal);
  assert.ok(!special.some(r=>r.key==='board75'));
  assert.equal(special.reduce((sum,r)=>sum+r.count,0),principal.pieces.length);
});
