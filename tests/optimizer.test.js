import test from 'node:test';
import assert from 'node:assert/strict';
import {CUTTING_DEFAULTS,DIAMETERS,createOptimizer,normalizeConfig,normalizeCuttingConfig,eqT,armMain,suggestM} from '../dist/optimizer.js';

test('configuración V2. Valores por defecto y catálogo',()=>{
  assert.deepEqual(normalizeConfig(),{cutting:CUTTING_DEFAULTS,length:4000});
  assert.equal(DIAMETERS.length,21);
  assert.equal(DIAMETERS[0],16);
  assert.equal(DIAMETERS.at(-1),56);
  assert.throws(()=>createOptimizer().solve(35),/catálogo/);
});
test('validación de formulario. Dimensiones, médula, cantidad y canteadora',()=>{
  for(const invalid of [{x1:''},{y1:0},{y2:-1},{y3:Infinity},{m:3},{m:-2},{m:2.5},{med:'yes'},{c:1.5},{a:0},{cm:'y1'},{cm:'bad'},{e1:50},{e2:70},{cw:0},{referenceDiameter:17}]){
    assert.throws(()=>normalizeCuttingConfig(invalid),JSON.stringify(invalid));
  }
  for(const length of ['',null,true,4000.1,499,12001])assert.throws(()=>normalizeConfig({length}),/Largo/);
  assert.doesNotThrow(()=>normalizeCuttingConfig({med:false,m:3,y2:0,y3:0}));
  assert.doesNotThrow(()=>normalizeCuttingConfig({x1:22,cm:'y1',referenceDiameter:16}));
});
test('armado. 2×22 por extremo, m/N y médula opcional',()=>{
  const p={...CUTTING_DEFAULTS,x2:50,x3:50,m:6};
  assert.equal(eqT(p),true);
  const arm=armMain(p);
  assert.equal(arm.seq.length,12);
  assert.ok(Math.abs(arm.X-486.2)<1e-8);
  assert.deepEqual(arm.seq.slice(0,2).map(p=>p.w),[22,22]);
  assert.deepEqual(arm.seq.slice(-2).map(p=>p.w),[22,22]);
  assert.equal(armMain({...p,med:false}).seq.length,10);
  assert.ok(!armMain({...p,med:false}).seq.some(piece=>piece.t==='a'));
});
test('largo aplicado a JAS y producción uniformemente, rendimiento independiente',()=>{
  const base=createOptimizer(),long=createOptimizer({length:8000});
  for(const d of DIAMETERS){
    const a=base.solve(d),b=long.solve(d);
    assert.equal(b.volume,2*a.volume);
    assert.equal(b.referenceVolume,2*a.referenceVolume);
    assert.equal(b.yield,a.yield);
  }
});
test('sugerencia m mantiene el armado y referencia configurada',()=>{
  const p={...CUTTING_DEFAULTS,d:42},before=JSON.stringify(p),m=suggestM(p);
  assert.equal(m%2,0);
  assert.equal(JSON.stringify(p),before);
  assert.ok(m>=0&&m<=20);
});

 test('objetivo rendimiento por defecto y selección nunca inferior a principal',()=>{
  assert.equal(normalizeCuttingConfig().objetivo,'rendimiento');
  assert.throws(()=>normalizeCuttingConfig({objetivo:'otro'}),/objetivo/);
  for(const d of DIAMETERS){
    const principal=createOptimizer({cutting:{objetivo:'principal'}}).solve(d);
    const rendimiento=createOptimizer().solve(d);
    assert.ok(rendimiento.yield>=principal.yield-1e-7,`Ø${d}`);
  }
 });
