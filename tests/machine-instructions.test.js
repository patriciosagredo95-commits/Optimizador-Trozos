import test from 'node:test';
import assert from 'node:assert/strict';
import {compute,createOptimizer,CUTTING_DEFAULTS,DIAMETERS,KC,KM} from '../dist/optimizer.js';
import {buildMachineInstructions} from '../dist/machine-instructions.js';
import {machineSheets,machineCSV} from '../dist/machine-reports.js';

const config={cutting:CUTTING_DEFAULTS,length:4000};
const results=DIAMETERS.map(diameterCm=>({diameterCm,cutting:compute({...CUTTING_DEFAULTS,d:diameterCm})}));
const build=(options={})=>buildMachineInstructions({config,results,date:'09-11-2026',...options});
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-7,`${a} ≠ ${b}`);

test('fichas incluyen sólo diámetros con trozos y suman el lote',()=>{
  const data=build({lot:new Map([[30,4],[42,7],[56,0]])});
  assert.deepEqual(data.rows.map(row=>row.diameter),[300,420]);
  assert.equal(data.totalLogs,11);assert.equal(data.catalogue,false);
});
test('lote vacío entrega los 21 diámetros, sin inventar trozos',()=>{
  const data=build();
  assert.deepEqual(data.rows.map(row=>row.diameter),DIAMETERS.map(d=>d*10));
  assert.equal(data.totalLogs,0);assert.equal(data.catalogue,true);
});
test('carro conserva caras y centros de carroK, lampazo R − |cara|',()=>{
  for(const row of build().rows){
    const r=results.find(result=>result.diameterCm*10===row.diameter).cutting;
    assert.equal(row.carriage.cutCount,row.diameter<360?1:3);
    row.carriage.cuts.forEach((cut,i)=>{
      const g=r.carroK[i],lo=cut.axis==='x'?g.x0:g.y0,hi=cut.axis==='x'?g.x1:g.y1;
      near(cut.sawCenter,(lo+hi)/2);near(hi-lo,KC);
      near(cut.barkThickness,r.R-Math.abs(cut.face));
    });
    if(r.big){near(row.carriage.baseWidth,r.X);near(row.carriage.lowerFace,r.yb);}
    else {near(row.carriage.face,r.F);near(row.carriage.cuts[0].barkThickness,r.R-r.F);}
  }
});
test('huinchas conserva orden de cuerpos y cuenta tablas por cada lampazo',()=>{
  for(const row of build().rows){
    const r=results.find(result=>result.diameterCm*10===row.diameter).cutting;
    assert.deepEqual(row.bands.bodies.map(b=>[b.role,b.from,b.to]),r.bodies.filter(b=>!b.empty).map(b=>[b.role,b.v0,b.v1]));
    near(row.bands.bodies.reduce((s,b)=>s+b.width,0),r.bodies.filter(b=>!b.empty).reduce((s,b)=>s+b.v1-b.v0,0));
    assert.equal(Object.values(row.bands.lampazos).reduce((a,b)=>a+b,0),r.boards.length);
    for(const [origin,count] of Object.entries(row.bands.lampazos))assert.equal(count,r.boards.filter(b=>b.origin.startsWith(origin+' · tabla ')).length);
  }
});
test('múltiple conserva armado fijo, posiciones acumuladas y ancho X para distintos programas',()=>{
  for(const cutting of [CUTTING_DEFAULTS,{...CUTTING_DEFAULTS,m:6},{...CUTTING_DEFAULTS,med:false,m:3,x1:22}]){
    const computed=DIAMETERS.map(diameterCm=>({diameterCm,cutting:compute({...cutting,d:diameterCm})}));
    const data=build({config:{cutting},results:computed}),m=data.multiple;
    near(m.pieces.reduce((sum,p)=>sum+p.width,0)+(m.pieces.length-1)*KM,m.width);
    near(m.pieces[0].start,0);near(m.pieces.at(-1).end,m.width);
    assert.equal(m.sawCount,m.pieces.length-1);
    m.saws.forEach((saw,i)=>{
      near(saw.start,m.pieces[i].end);near(saw.end,m.pieces[i+1].start);
      near(saw.center,(saw.start+saw.end)/2);
      near(saw.center,computed[0].cutting.A.seq[i].u1+m.width/2+KM/2);
    });
    assert.deepEqual(computed.map(r=>r.cutting.A.X),computed.map(()=>m.width));
  }
});
test('canteadora conserva tablas, descartes, planes y posiciones con sierras exteriores',()=>{
  const data=build(),e=data.edger;
  assert.deepEqual(e.pieces.map(p=>p.width),[60,75,75]);
  near(e.width,60+75+75+2*KM);
  near(e.sawCenters[0],-KM/2);
  e.pieces.forEach((p,i)=>near(e.sawCenters[i+1],p.end+KM/2));
  for(const row of data.rows){
    const r=results.find(result=>result.diameterCm*10===row.diameter).cutting;
    assert.equal(row.edger.boards,r.cant.length);
    assert.equal(row.edger.accepted+row.edger.discarded,r.cant.length);
    assert.deepEqual(row.edger.plans.map(p=>p.widths),r.cant.map(b=>b.plan.map(p=>p.w)));
    assert.equal(row.edger.pieces,r.cant.reduce((s,b)=>s+b.plan.length,0));
  }
});
test('acepta resultados adaptados del motor sin mutarlos',()=>{
  const engine=createOptimizer(config),result=engine.solve(42),before=JSON.stringify(result);
  const data=build({results:[result],lot:{42:2}});
  assert.equal(data.rows.length,1);assert.equal(JSON.stringify(result),before);
  assert.equal(data.multiple.width,result.cutting.A.X);
});
test('rechaza geometría faltante y armados mezclados',()=>{
  assert.throws(()=>build({results:[],lot:{42:1}}),/Falta la geometría/);
  assert.throws(()=>build({lot:{30:1,42:1},results:[results.find(r=>r.diameterCm===30),{diameterCm:42,cutting:compute({...CUTTING_DEFAULTS,m:4,d:42})}]}),/solo armado/);
});
test('impresión entrega cuatro páginas, encabezados repetidos y selección individual',()=>{
  const data=build(),html=machineSheets(data);
  assert.equal((html.match(/class="machine-page"/g)||[]).length,4);
  assert.equal((html.match(/Cómo leer esta ficha/g)||[]).length,4);
  assert.equal((html.match(/Fecha 09-11-2026/g)||[]).length,4);
  assert.equal((machineSheets(data,'bands').match(/class="machine-page"/g)||[]).length,1);
  assert.ok(html.includes('3,4 mm'));assert.ok(html.includes('4,2 mm'));
});
test('CSV contiene las cotas y secuencias de las cuatro máquinas y metadatos de corrida',()=>{
  const csv=machineCSV(build({lot:{30:2,42:3}}));
  assert.ok(csv.startsWith('\ufeff'));assert.ok(csv.includes('"30 cm";"2"'));
  assert.ok(csv.includes('"42 cm";"3"'));assert.ok(!csv.includes('"16 cm";'));
  for(const label of ['Carro huincha','Huinchas 1 y 2','Sierra múltiple','Canteadora','R − |cara|','Centros de sierras','09-11-2026'])assert.ok(csv.includes(label));
  assert.ok(csv.includes('"3,4"'));assert.ok(csv.includes('"4,2"'));
});

test('operator sheets use cm, plant names and unsigned carriage positions at 36 and 46 cm',()=>{
  const data=build({lot:{36:1,46:1}}),html=machineSheets(data),csv=machineCSV(data);
  for(const d of [36,46])assert.ok(html.includes(`${d} cm`));
  assert.ok(html.includes('Desde 36 cm'));
  assert.ok(html.includes('Principal 50×100'));
  assert.ok(html.includes('Tabla central 26'));
  assert.ok(html.includes('sierras internas'));
  assert.ok(!html.includes('Y1'));assert.ok(!csv.includes('Y1'));
  assert.ok(!html.includes('360,0'));assert.ok(!html.includes('46,0'));
  assert.ok(!/[−-]\d/.test(html.replace(/<[^>]*>/g,'').replaceAll('09-11-2026','')));
  assert.ok(!/[−-]\d/.test(csv.replaceAll('09-11-2026','')));
  assert.match(html,/primer corte exterior en 0/i);
  assert.ok(csv.includes('0 (corte de borde)'));
});
test('zero and negative bark thickness explicitly omit the bottom slab',()=>{
  for(const thickness of [0,-12]){
    const data=build({lot:{36:1,46:1}});
    for(const row of data.rows){row.carriage.cuts[2].barkThickness=thickness;row.carriage.cuts[0].barkThickness=thickness;}
    const html=machineSheets(data,'carriage'),csv=machineCSV(data);
    assert.equal((html.match(/Sin lampazo inferior/g)||[]).length,2);
    assert.ok(html.includes('Sin lampazo'));
    assert.ok(csv.includes('Sin lampazo inferior'));
    assert.ok(!html.includes('-12'));assert.ok(!csv.includes('-12'));
  }
});
test('small and large carriage instructions have separate cut tables',()=>{
  const html=machineSheets(build({lot:{30:1,36:1,46:1}}),'carriage');
  assert.equal((html.match(/<table>/g)||[]).length,2);
  assert.ok(html.includes('un corte / un lampazo'));
  assert.ok(html.includes('tres cortes'));
  assert.ok(html.includes('cada cara a la mitad de X, una a cada lado'));
});
