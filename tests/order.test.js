import test from 'node:test';
import assert from 'node:assert/strict';
import {createOptimizer,DIAMETERS} from '../dist/optimizer.js';
import {bestYieldAlternative,simulateOrder} from '../dist/order.js';

test('vista y pedido. Por defecto gana el mayor rendimiento; con objetivo principal, principal sana antes del rendimiento',()=>{
  const base=createOptimizer().solve(30),a=base.alternatives[0];
  const b={...a,cutting:{...a.cutting,nPrin:a.cutting.nPrin-1},volume:1,yield:1000};
  // Comportamiento V2 validado con prioridad principal.
  assert.equal(bestYieldAlternative({...base,alternatives:[b,a]},'principal').alternative,2);
  // Objetivo por defecto: mayor rendimiento total.
  assert.equal(bestYieldAlternative({...base,alternatives:[b,a]}).alternative,1);
  const c={...a,volume:a.volume*.9,yield:a.yield*.9};
  assert.equal(bestYieldAlternative({...base,alternatives:[c,a]},'principal').alternative,2);
  assert.equal(bestYieldAlternative({...base,alternatives:[c,a]}).alternative,2);
  assert.equal(bestYieldAlternative({status:'no_pattern'}),null);
});
test('pedido mixto. Los tres productos, otras piezas y JAS ponderado',()=>{
  const engine=createOptimizer(),results=new Map(DIAMETERS.map(d=>[d,engine.solve(d)]));
  const stock={16:2,26:3,30:4,36:2,48:1,56:2},plan=simulateOrder(results,stock);
  for(const [diameter,count] of Object.entries(stock)){
    const row=plan.rows.find(row=>row.diameterCm===Number(diameter)),r=results.get(Number(diameter));
    assert.equal(row.piecesA,count*r.cutting.nPrin);
    assert.equal(row.piecesB,count*r.cutting.nApr);
    assert.equal(row.piecesC,count*r.cutting.nApr2);
    assert.equal(row.recoveryPieces,count*r.recoveryCount);
    assert.equal(row.volumeM3,count*r.volume);
  }
  assert.equal(plan.totals.usedLogs,14);
  assert.equal(plan.totals.yieldPercent,100*plan.totals.volumeM3/plan.totals.referenceVolumeM3);
  assert.equal(plan.totals.piecesC,plan.rows.reduce((sum,row)=>sum+row.piecesC,0));
});
test('pedido. Stock entero, ausente, vacío y patrón ausente',()=>{
  const results=new Map([[30,createOptimizer().solve(30)]]);
  for(const bad of [-1,1.5,10001,Infinity,'abc'])assert.throws(()=>simulateOrder(results,{30:bad}),/entero/);
  const empty=simulateOrder(results,{});
  assert.equal(empty.totals.usedLogs,0);
  assert.equal(empty.totals.yieldPercent,null);
  const missing=simulateOrder(results,new Map([[16,2],[30,1]]));
  assert.equal(missing.totals.unusedLogs,2);
  assert.equal(missing.rows[0].status,'no_pattern');
});
