import test from 'node:test';
import assert from 'node:assert/strict';
import {planRun,compareRuns,normalizeLot} from '../dist/run-planner.js';
import {DIAMETERS,CUTTING_DEFAULTS,suggestM,compute} from '../dist/optimizer.js';
import {configurationFile,parseConfiguration,restoreConfiguration,STORAGE_KEY} from '../dist/reports.js';

test('corrida. Determinismo, ranking y cantidades cero ignoradas',()=>{
  const input={lot:{16:0,30:2,42:4,56:1}};
  const first=planRun(input),second=planRun({...input,lot:{30:2,42:4,56:1}});
  assert.deepEqual(first,second);
  assert.equal(first.candidates.length,3);
  for(const [i,candidate] of first.candidates.entries()){
    assert.deepEqual(candidate.rows.map(row=>row.diameterCm),[30,42,56]);
    assert.equal(candidate.totals.logs,7);
    assert.equal(candidate.totals.piecesA,candidate.rows.reduce((sum,row)=>sum+row.qty*row.principalPerLog,0));
    assert.ok(Math.abs(candidate.totals.referenceVolumeM3-(2*30*30*.0004+4*42*42*.0004+56*56*.0004))<1e-12);
    if(i)assert.ok(compareRuns(first.candidates[i-1],candidate)<=0);
  }
});

test('corrida Ø42. La múltiple coincide con la mejor sugerencia entre ambas opciones de médula',()=>{
  // suggestM searches m for one pith setting. The run searches both settings.
  const references=[true,false].map(med=>{
    const m=suggestM({...CUTTING_DEFAULTS,med,d:42});
    const raw=compute({...CUTTING_DEFAULTS,med,m,d:42});
    return {med,m,principal:raw.nPrin,volume:raw.vProd};
  }).sort((a,b)=>b.principal-a.principal||b.volume-a.volume);
  const winner=planRun({lot:{42:10}}).candidates[0].config.cutting;
  assert.equal(winner.m,references[0].m);
  assert.equal(winner.med,references[0].med);
});

test('corrida. Objetivo volumen ordena volumen primero y cambia la recomendación',()=>{
  const lot=Object.fromEntries(DIAMETERS.map(d=>[d,1]));
  const principal=planRun({lot}),volume=planRun({lot,objective:'volume'});
  for(let i=1;i<3;i++)assert.ok(compareRuns(volume.candidates[i-1],volume.candidates[i],'volume')<=0);
  assert.ok(volume.candidates[0].totals.volumeM3>=principal.candidates[0].totals.volumeM3);
  assert.notDeepEqual(volume.candidates[0].config,principal.candidates[0].config);
});

test('corrida. Validación de lote vacío, cantidades y objetivo',()=>{
  for(const lot of [{},{42:0}])assert.throws(()=>planRun({lot}),/al menos un trozo/);
  for(const qty of [-1,1.5,10001,'abc',Infinity])assert.throws(()=>planRun({lot:{42:qty}}),/entero/);
  assert.throws(()=>planRun({lot:{42:1},objective:'bad'}),/objetivo/);
  assert.equal(normalizeLot(new Map([[42,3]]))[42],3);
});

test('corrida. Restricciones fijas, progreso y suma ponderada del motor V2',()=>{
  const updates=[];
  const result=planRun({config:{cutting:{a:22,c:3,cm:'otro',cw:90}},lot:{16:3,42:2}},progress=>updates.push(progress));
  assert.equal(updates.at(-1).completed,updates.at(-1).total);
  for(const candidate of result.candidates){
    const p=candidate.config.cutting;
    assert.equal(p.a,22);assert.equal(p.c,3);assert.equal(p.cw,90);
    assert.ok(!p.med||p.m%2===0);assert.ok(p.m<=20);
    assert.ok(['60','75','otro'].includes(p.cm));
    for(const row of candidate.rows){
      const raw=compute({...p,d:row.diameterCm,length:candidate.config.length});
      assert.equal(row.principalPerLog,raw.nPrin);
      assert.equal(row.volumeM3,row.qty*raw.vProd);
      assert.equal(row.edgerPieces,row.qty*raw.cant.reduce((sum,b)=>sum+b.plan.length,0));
    }
  }
});

test('corrida. JSON y almacenamiento preservan lote, modo y objetivo',()=>{
  const config={cutting:{...CUTTING_DEFAULTS},length:6000,lot:normalizeLot({42:12}),mode:'advanced',objective:'volume'};
  assert.deepEqual(parseConfiguration(configurationFile(config)),config);
  assert.deepEqual(restoreConfiguration({getItem:key=>key===STORAGE_KEY?JSON.stringify(config):null}),config);
  const old=restoreConfiguration({getItem:()=>null});
  assert.equal(old.length,4000);assert.equal(old.lot,undefined);
});

test('top three alternatives use three distinct multiple assemblies',()=>{
  for(const lot of [{42:10},{16:3,36:2,46:4}]){
    const {candidates}=planRun({lot});
    assert.equal(candidates.length,3);
    assert.equal(new Set(candidates.map(candidate=>JSON.stringify([candidate.config.cutting.med,candidate.config.cutting.m]))).size,3);
  }
});
