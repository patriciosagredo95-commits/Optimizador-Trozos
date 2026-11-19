import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {compute,computeF,CUTTING_DEFAULTS,createOptimizer,DIAMETERS,armMain,suggestM,assertGeometry} from '../dist/optimizer.js';
// comportamiento V2 validado con prioridad principal
const cases={A:{...CUTTING_DEFAULTS,objetivo:'principal'},B:{...CUTTING_DEFAULTS,objetivo:'principal',x1:55,y1:75,x2:22,y2:75,x3:22,y3:60,a:22,m:4},C:{...CUTTING_DEFAULTS,objetivo:'principal',x2:50,x3:50,m:6}};
const scheme=r=>['Y1','Y2','Y3'].map(role=>r.bodies.filter(body=>body.role===role).length);
// Casos del §11 de "Modelo V2/CLAUDE.md" recalculados con las reglas de planta del 2026-11-09
// (piezas con canto muerto no dan la medida). Las piezas principales no cambian respecto del V2;
// bajan aprovechamientos y tablas a clasificación, y suben las tablas a canteadora.
// Valores V2 originales [principal, aprov1, aprov2, clas, descartadas, canteadora] y rendimiento:
// A30 [4,0,2,6,6,1] 58,7 % · A42 igual · B26 [2,2,2,0,4,1] 50,3 % · B34 [10,0,2,0,6,3] 53,7 %
// B40 [12,4,0,8,12,0] 59,8 % · B48 [16,4,0,16,12,2] 58,4 % · C36 igual · C46 [12,8,0,4,12,2] 58,1 %
// C52 [18,8,0,6,8,4] 61,3 %.
const regressions=[
  ['A',30,[2,0,0],[4,0,0,4,0,6],.20168,.36],
  ['A',42,[3,0,0],[6,0,0,12,0,8],.39888,.7056],
  ['B',26,[1,1,0],[2,2,0,0,2,3],.12276,.2704],
  ['B',34,[3,0,0],[10,0,0,0,0,10],.24552,.4624],
  ['B',40,[3,0,2],[12,0,4,4,4,12],.35904,.64],
  ['B',48,[4,0,2],[16,0,4,8,4,8],.50424,.9216],
  ['C',36,[2,0,2],[8,0,4,0,4,2],.28616,.5184],
  ['C',46,[2,2,0],[12,8,0,0,4,4],.48032,.8464],
  ['C',52,[3,2,0],[18,4,0,2,8,12],.59456,1.0816]
];
for(const [name,d,expectedScheme,counts,volume,jas] of regressions){
  test(`§11 caso ${name} Ø${d}. Esquema, cantidades, producción y rendimiento`,()=>{
    const r=compute({...cases[name],d});
    assert.deepEqual(scheme(r),expectedScheme);
    assert.deepEqual([r.nPrin,r.nApr,r.nApr2,r.nClas,r.nLost,r.nCant],counts);
    assert.ok(Math.abs(r.vProd-volume)<1e-9);
    assert.ok(Math.abs(r.vJAS-jas)<1e-9);
    assert.ok(Math.abs(r.yield-volume/jas)<=.002);
  });
}
// Reglas de planta confirmadas el 2026-11-09, que el motor aplica sobre el prototipo V2:
// 1) tabla de 22 con canto muerto → canteadora; sana → clasificación, o principal si la principal es 22 × Y1;
// 2) pieza de aprovechamiento con canto muerto → descartada (el prototipo aceptaba hasta 10 % de pérdida);
// 3) con principal de 22 mm, toda pieza de canteadora del ancho de la principal es medida principal.
// Se aplican las mismas reglas al script del prototipo para que el cruce siga verificando todo lo demás.
const PLANT_RULES=[
  ["if(q.t==='22'){const L=st==='full'?0:lossFrac(q.u0,q.u1,B.v0,B.v1,R,B.ul); cls=L<=LOSS_OK?'clas':(L>LOSS_MAX?'lost':'cant');}",
   "if(q.t==='22'){const x1=B.arm.seq.find(s=>s.t==='X1')?.w; cls=st==='full'?(B.role==='Y1'&&x1===T?'prin':'clas'):'cant';}"],
  ["const kind=q.t==='a'?'med':(B.role==='Y2'?'apr':'apr2'), L=st==='full'?0:lossFrac(q.u0,q.u1,B.v0,B.v1,R,B.ul); cls=L<=LOSS_OK?kind:'lost'; }",
   "const kind=q.t==='a'?'med':(B.role==='Y2'?'apr':'apr2'); cls=st==='full'?kind:'lost'; }"],
  ["nLost+' tabla'+(nLost>1?'s':'')+' de 22 mm de la múltiple pierde'+(nLost>1?'n':'')+' más del 25 % de volumen y no se cuenta'+(nLost>1?'n':'')+' como producción.'",
   "nLost+' pieza'+(nLost>1?'s':'')+' de aprovechamiento con canto muerto no da'+(nLost>1?'n':'')+' la medida y no se cuenta'+(nLost>1?'n':'')+' como producción.'"],
  ["add('lost'+(q.v1-q.v0),'Tabla 22 descartada (> 25 % pérdida)','22 × '+fmt(q.v1-q.v0),'Pérdida',0)",
   "add('lost'+q.w+'x'+(q.v1-q.v0),'Pieza con canto muerto (descartada)',fmt(q.w)+' × '+fmt(q.v1-q.v0),'Pérdida',0)"],
  ["function cantCenter(p){ if(p.cm==='60')return {w:60,k:'clas',lab:'60'}; if(p.cm==='75')return {w:75,k:'clas',lab:'75'};",
   "const cantKind=(w,p)=>p.x1===T&&w===p.y1?'prin':'clas'; function cantCenter(p){ if(p.cm==='60')return {w:60,k:cantKind(60,p),lab:'60'}; if(p.cm==='75')return {w:75,k:cantKind(75,p),lab:'75'};"],
  ["return {w:p.cw,k:'clas',lab:fmt(p.cw)}; }","return {w:p.cw,k:cantKind(p.cw,p),lab:fmt(p.cw)}; }"],
  ["E1={w:p.e1,k:'clas',lab:String(p.e1)}, E2={w:p.e2,k:'clas',lab:String(p.e2)};",
   "E1={w:p.e1,k:cantKind(p.e1,p),lab:String(p.e1)}, E2={w:p.e2,k:cantKind(p.e2,p),lab:String(p.e2)};"]
];
function applyPlantRules(script){
  for(const [from,to] of PLANT_RULES){
    assert.equal(script.split(from).length-1,1,`regla de planta no encontrada una vez en el prototipo: ${from.slice(0,60)}`);
    script=script.replace(from,()=>to);
  }
  return script;
}
function prototypeOracle(){
  const html=readFileSync(new URL('../Modelo V2/esquemas_corte_prototipo.html',import.meta.url),'utf8');
  let script=html.match(/<script>([\s\S]*?)<\/script>/)[1];
  script=script.replace(/syncWiz\(\); renderWiz\(\);\s*\}\)\(\);\s*$/, 'globalThis.oracle={compute,armMain,suggestM};})();');
  script=applyPlantRules(script);
  const node=()=>({value:'',addEventListener(){},setAttribute(){},classList:{toggle(){}},querySelector(){return node();}});
  const context=vm.createContext({document:{getElementById:node,querySelectorAll:()=>[]},localStorage:{getItem:()=>null,setItem(){}},window:{scrollTo(){}}});
  vm.runInContext(script,context,{timeout:5000});return context.oracle;
}
function digest(r){return JSON.parse(JSON.stringify({F:r.F,big:r.big,X:r.X,drop:r.drop,nIn:r.nIn,scheme:scheme(r),nLost:r.pieces.filter(q=>q.cls==='lost').length,nLost22:r.pieces.filter(q=>q.cls==='lost'&&q.t==='22').length,nPrin:r.nPrin,nApr:r.nApr,nApr2:r.nApr2,nClas:r.nClas,nCant:r.nCant,vProd:r.vProd,vJAS:r.vJAS,yield:r.yield,prod:r.prod,warn:r.warn,block:r.block,nY1:r.nY1,nPrinCant:r.nPrinCant,bodies:r.bodies.map(b=>({o:b.o,role:b.role,v0:b.v0,v1:b.v1,ul:b.ul,pieces:b.pieces.map(q=>[q.w,q.u0,q.u1,q.cls,q.st])})),carroK:r.carroK,huinK:r.huinK,boardK:r.boardK,boards:r.boards,cant:r.cant.map(c=>({W:c.W,plan:c.plan,g:c.g}))}));}

test('crosscheck del script real. A/B/C × todos los enteros Ø16–56, 123/123',()=>{
  const oracle=prototypeOracle();
  const mismatches=[];
  let checked=0;
  for(const [name,p] of Object.entries(cases))for(let d=16;d<=56;d++){
    try{assert.deepEqual(digest(compute({...p,d})),digest(oracle.compute({...p,d})));}
    catch(error){mismatches.push(`${name} Ø${d}: ${error.message}`);}
    checked++;
  }
  assert.equal(checked,123);
  assert.deepEqual(mismatches,[]);
  for(const p of Object.values(cases))for(const d of [16,30,42,56]){
    assert.deepEqual(JSON.parse(JSON.stringify(armMain(p))),JSON.parse(JSON.stringify(oracle.armMain(p))));
    assert.equal(suggestM({...p,d}),oracle.suggestM({...p,d}));
  }
});
test('catálogo completo. Geometría, catálogo físico y alternativas distintas j/F',()=>{
  for(const p of Object.values(cases)){
    const engine=createOptimizer({cutting:p});
    for(const d of DIAMETERS){
      const r=engine.solve(d);
      assert.equal(r.method,'v2');
      assert.doesNotThrow(()=>JSON.stringify(r));
      assert.equal(r.alternatives.length,2);
      const [a,b]=r.alternatives;
      assert.notEqual(a.cutting.big?a.cutting.drop:a.cutting.F,b.cutting.big?b.cutting.drop:b.cutting.F);
      assert.ok(a.cutting.nPrin>b.cutting.nPrin||a.cutting.nPrin===b.cutting.nPrin&&a.yield>=b.yield-1e-7);
      for(const alternative of r.alternatives){
        assertGeometry(alternative,engine.config);
        assert.ok(alternative.geometricYield<=100);
        assert.equal(alternative.counts[0].quantity,alternative.cutting.nPrin);
        assert.equal(alternative.counts[1].quantity,alternative.cutting.nApr);
        assert.equal(alternative.counts[2].quantity,alternative.cutting.nApr2);
        assert.equal(alternative.counts.slice(0,3).reduce((sum,q)=>sum+q.quantity,0)+alternative.recoveryCount,alternative.totalCount);
      }
    }
  }
});
test('cara plana. Barrido cada 2 mm, orientación yu y 1–2 tablas del carro',()=>{
  for(const p of Object.values(cases))for(const d of DIAMETERS.filter(d=>d<36)){
    const r=compute({...p,d});
    const R=d*5,uMax=Math.sqrt(R*R-30*30),F1=uMax-25.4-.5,F3=uMax-3*25.4;
    assert.ok(r.F>F3&&r.F<=F1);
    assert.ok(Math.abs((F1-r.F)/2-Math.round((F1-r.F)/2))<1e-8);
    assert.ok(r.bodies.every(body=>body.o==='yu'));
    assert.equal(r.carroK.length,1);
    assert.ok([1,2].includes(r.boards.filter(board=>board.origin.startsWith('Lampazo del carro')).length));
    for(let F=F1;F>F3;F-=2){
      const candidate=computeF({...p,d},F);
      assert.ok(r.nPrin>candidate.nPrin||r.nPrin===candidate.nPrin&&r.yield>=candidate.yield-1e-9);
    }
  }
});
test('presentación decimal: canteadora no mezcla 75 con 75,4 mm ni redondea secciones',()=>{
  const p={...CUTTING_DEFAULTS,e1:75,e2:75,cm:'otro',cw:75.4};
  const raw=compute({...p,d:50});
  const rows=raw.prod.filter(q=>q.label==='Canteadora');
  assert.ok(rows.some(q=>q.sec==='22 × 75'));
  assert.ok(rows.some(q=>q.sec==='22 × 75,4'));
  const result=createOptimizer({cutting:p}).solve(50);
  assert.ok(result.products.some(q=>q.cls==='cant'&&q.width===75));
  assert.ok(result.products.some(q=>q.cls==='cant'&&q.width===75.4));
  assert.ok(Math.abs(result.products.reduce((area,q)=>area+q.area*result.counts[q.id].quantity,0)*4000/1e9-result.volume)<1e-9);
});
