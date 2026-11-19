import test from 'node:test';
import assert from 'node:assert/strict';
import {parseEscuadria,detectPrograms,buildLot,theoreticalForDay,periodStats,hourlyCurves} from '../dist/analysis.js';
import {planRun} from '../dist/run-planner.js';
import {horizontal,accumulated,divergent} from '../dist/analysis-charts.js';
import {readFileSync} from 'node:fs';
test('esperado por escuadría conserva el rendimiento y el total PLC',()=>{
 const day={produccion:55,consumo:100,trozosPLC:250,productos:[{esc:'54X75X4000',m3:55}],diametros:[{d:32,trozos:100,m3:100}]};
 const r=theoreticalForDay(day,planRun);
 assert.ok(r.porEscuadria.some(p=>p.esc==='54×75'));
 assert.ok(r.porEscuadria.some(p=>p.esc==='22×75'));
 assert.ok(Math.abs(r.porEscuadria.reduce((s,p)=>s+p.frac,0)/r.yieldTeo-1)<.005);
 const live=liveToday(day,{...r,factor:1.06,jas:.45});
 assert.ok(Math.abs(live.porEscuadria.reduce((s,p)=>s+p.m3Teo,0)-live.m3Teo)<live.m3Teo*.005);
});
test('textos y gráficos de operaciones',()=>{
 const view=readFileSync(new URL('../dist/analysis-view.js',import.meta.url),'utf8');
 assert.doesNotMatch(view,/teóric[oa]/i);
 assert.doesNotMatch(view,/Trozos por hora \(contador PLC\)|Trozos por diámetro \(cm\)|Al ritmo actual/);
 assert.match(view,/Producción real \(Actualmente\)/);
 assert.match(view,/Proyección al cierre/);
 const chart=accumulated([],DEFAULT_TURNO,at('08:00'),{});
 assert.match(chart,/viewBox="0 0 1300 245"/);assert.match(chart,/09:00/);
 assert.match(divergent([]),/real − esperado/);
 const bars=horizontal([{esc:'54×75',m3:2,paq:1,piezas:10}],[{esc:'54×75',m3Teo:3},{esc:'22×75',m3Teo:1}]);
 assert.match(bars,/2,0 de 3,0 m³ esperados/);assert.match(bars,/0,0 de 1,0/);
 assert.match(bars,/expected-mark/);
});
const p=(esc,m3=10)=>({esc,m3});
test('parseEscuadria: separadores, decimales y entradas inválidas',()=>{assert.deepEqual(parseEscuadria('54,5x75.2X4000'),{espesor:54.5,ancho:75.2,largo:4000});assert.equal(parseEscuadria('basura'),null);assert.equal(parseEscuadria('0X75X4000'),null);});
test('programas PRD y subproductos',()=>{
 const detect=rows=>detectPrograms(rows.map(([esc,m3])=>p(esc+'X4000',m3)));
 assert.equal(detect([['54X75',10],['22X75',4],['22X60',2]]).label,'54×75');
 const a=detect([['37X132',20],['22X132',8],['37X75',10]]).programs[0];assert.equal(a.x1,37);assert.equal(a.y1,132);assert.equal(a.y2,75);assert.equal(a.cw,132);
 assert.equal(detect([['22X125',10],['22X75',3],['22X60',2]]).label,'22×125');
 const mix=detect([['55X75',40],['22X125',39],['22X75',5]]);assert.equal(mix.mixto,true);assert.ok(Math.abs(mix.programs[0].weight-40/79)<1e-9);
 assert.equal(detect([['22X75',5]]).label,'22×75');assert.equal(detect([['54X75',1],['37X132',60]]).programs.length,1);
});
test('diámetros extremos e impares',()=>{const r=buildLot([{d:14,trozos:1,m3:2},{d:58,trozos:2,m3:3},{d:31,trozos:3,m3:5}]);assert.equal(r.lot[16],1);assert.equal(r.lot[56],2);assert.equal(r.lot[32],3);assert.equal(r.outOfRangePercent,50);});
test('teórico con modelo real y volumen PRD',()=>{const day={produccion:55,consumo:100,productos:[p('54X75X4000')],diametros:Array.from({length:12},(_,i)=>({d:30+2*i,trozos:10,m3:100/12}))};const r=theoreticalForDay(day,planRun);assert.ok(r.yieldTeo>.4&&r.yieldTeo<.65);assert.ok(Math.abs(r.m3Teo-r.yieldTeo*day.consumo)<1e-9);assert.equal(theoreticalForDay({consumo:0},planRun),null);});
test('estadísticas ponderadas y curvas acumuladas',()=>{const points=[{consumo:100,produccion:50,m3Teo:60,yieldReal:.5,yieldTeo:.6},{consumo:200,produccion:140,m3Teo:120,yieldReal:.7,yieldTeo:.6}];const s=periodStats(points);assert.ok(Math.abs(s.desvPp-100/30)<1e-9);assert.ok(Math.abs(s.stdPp-10)<1e-9);assert.equal(s.bajo,1);assert.equal(s.N,2);assert.equal(s.brechaM3,10);const h=hourlyCurves({horas:[{h:'09:00',produccion:4,consumo:10,trozos:2,trozosPLC:3},{h:'10:00',produccion:5,consumo:20,trozos:4,trozosPLC:5}]},.5);assert.equal(h[1].real,9);assert.equal(h[1].teorico,15);assert.equal(h[1].trozosPLC,5);});

import {factorPLC,jasPorTrozo,liveToday,ritmo,detectStops,productionByEscuadria,sameProgramStats,DEFAULT_TURNO} from '../dist/analysis.js';
const at=t=>new Date('2026-11-19T'+t+':00');
test('PLC: ajuste ponderado, limites y JAS',()=>{assert.equal(factorPLC([]),1);assert.equal(factorPLC([{trozos:106,trozosPLC:100}]),1.06);assert.equal(factorPLC([{trozos:200,trozosPLC:100}]),1.2);assert.equal(factorPLC([{trozos:1,trozosPLC:100}]),.9);assert.equal(jasPorTrozo({trozos:20,consumo:10}),.5);assert.equal(jasPorTrozo({},[{f:'2026-01-01',trozos:10,consumo:4}]),.4);assert.equal(jasPorTrozo({}),.45);});
test('PLC: cinco estados y curvas',()=>{const options={yieldTeo:.5,factor:1,jas:1};for(const [produccion,state] of [[60,'sobre'],[50,'bien'],[44,'atento'],[40,'bajo']])assert.equal(liveToday({trozosPLC:100,produccion},options).semaforo,state);assert.equal(liveToday({trozosPLC:29,produccion:60},options).semaforo,'espera');const v=liveToday({trozosPLC:100,produccion:45,tickets:10,horas:[{h:'08:00',trozosPLC:50,produccion:20},{h:'09:00',trozosPLC:50,produccion:25}]},options);assert.equal(v.consumoEst,100);assert.equal(v.difM3,-5);assert.equal(v.curvas[1].teo,50);assert.equal(v.curvas[1].real,45);});
test('ritmo: colacion, referencia, proyeccion y minimo',()=>{const d={trozosPLC:300,produccion:60};const r=ritmo(d,[{trozosPLC:600}],DEFAULT_TURNO,at('13:00'),{yieldTeo:.5,factor:1,jas:.5});assert.equal(r.horasTranscurridas,4);assert.equal(r.horasRestantes,3.5);assert.equal(r.referencia,80);assert.equal(r.trozosProy,562.5);assert.equal(r.m3RealProy,112.5);assert.equal(r.m3TeoProy,140.625);assert.equal(ritmo(d,[],DEFAULT_TURNO,at('08:29')).trozosProy,null);});
const samples=times=>times.map(t=>({t:'2026-11-19T'+t+':00',valor:100}));
test('detenciones: umbral, vigencia y huecos',()=>{let r=detectStops(samples(['11:00','11:05','11:10']),DEFAULT_TURNO,at('11:12'));assert.equal(r.detenida,true);assert.equal(r.totalMin,10);assert.equal(r.minutosActual,10);assert.equal(detectStops(samples(['11:00','11:09']),DEFAULT_TURNO,at('11:10')).totalMin,0);assert.equal(detectStops(samples(['11:00','11:16','11:20']),DEFAULT_TURNO,at('11:21')).totalMin,0);assert.equal(detectStops(samples(['11:00','11:05','11:10']),DEFAULT_TURNO,at('11:17')).detenida,false);});
test('detenciones: colacion excluida y turno',()=>{const times=['11:55','12:00','12:10','12:20','12:30','12:40','12:50','13:00','13:05'];assert.equal(detectStops(samples(times),DEFAULT_TURNO,at('13:06')).totalMin,10);assert.equal(detectStops(samples(['07:00','07:10']),DEFAULT_TURNO,at('08:00')).totalMin,0);});
test('escuadrias agrupadas y programa principal ponderado',()=>{assert.deepEqual(productionByEscuadria([{esc:'54X75X4000',m3:2,piezas:5,paq:1},{esc:'54X75X3000',m3:3,piezas:6,paq:2}]),[{esc:'54×75',m3:5,piezas:11,paq:3}]);const points=[{f:'2026-01-01',consumo:100,yieldReal:.5,yieldTeo:.6,programs:[{x1:54,y1:75,weight:1}]},{f:'2026-01-02',consumo:300,yieldReal:.7,yieldTeo:.6,programs:[{x1:54,y1:75,weight:.8},{x1:22,y1:60,weight:.2}]}];const r=sameProgramStats(points,'54×75');assert.equal(r.dias.length,2);assert.equal(r.yieldReal,.65);assert.equal(r.yieldTeo,.6);assert.equal(sameProgramStats(points,'22×60').dias.length,0);});

import {perfilRegistro,factorRegistro,estadoDatos} from '../dist/analysis.js';
const perfil={marcas:[{t:'09:00',k:.8,n:3},{t:'17:00',k:1,n:3}],dias:3};
test('registro: mediana, acumulados finales, minimo de dias y umbral PLC',()=>{
 const days=Array.from({length:4},(_,i)=>({f:`2026-10-0${i+1}`,produccion:100,trozosPLC:100,horas:[{h:'08:00',produccion:8,trozosPLC:10},{h:'09:00',produccion:92,trozosPLC:90}]}));
 const p=perfilRegistro(days,DEFAULT_TURNO,3);assert.equal(p.dias,3);assert.equal(p.marcas[0].t,'09:00');assert.ok(Math.abs(p.marcas[0].k-.8)<1e-9);assert.equal(p.marcas[1].k,1);assert.equal(p.marcas[0].n,3);
 assert.deepEqual(perfilRegistro(days.slice(0,2)).marcas,[]);
 for(const d of days)d.horas[0]={h:'08:00',produccion:4,trozosPLC:4};assert.equal(perfilRegistro(days).marcas[0].t,'10:00');
 for(const d of days)d.horas[0]={h:'08:00',produccion:4,trozosPLC:5};assert.equal(perfilRegistro(days).marcas[0].t,'09:00');
});
test('registro: interpolacion y extremos',()=>{assert.equal(factorRegistro(perfil,480),.8);assert.equal(factorRegistro(perfil,780),.9);assert.equal(factorRegistro(perfil,1200),1);assert.equal(factorRegistro(null,700),1);});
test('registro: semaforo, rendimiento y curvas ajustados',()=>{
 const p={marcas:[{t:'09:00',k:.8},{t:'10:00',k:1}]};
 const v=liveToday({trozosPLC:100,produccion:40,horas:[{h:'08:00',trozosPLC:50},{h:'09:00',trozosPLC:50}]},{yieldTeo:.5,jas:1,perfil:p,ahora:570});
 assert.equal(v.m3TeoBruto,50);assert.equal(v.m3TeoReg,45);assert.equal(v.semaforo,'atento');assert.equal(v.rendReal,40/90);assert.equal(v.curvas[0].teo,20);assert.equal(v.curvas[1].teo,45);assert.equal(v.curvas[1].teoBruto,50);
 const good=liveToday({trozosPLC:100,produccion:40},{yieldTeo:.5,jas:1,perfil:p,ahora:540});assert.equal(good.semaforo,'bien');assert.equal(good.rendReal,.5);
});
test('registro: proyeccion mantiene desempeno y trozos',()=>{
 const d={trozosPLC:300,produccion:60},opts={yieldTeo:.5,factor:1,jas:.5};
 const a=ritmo(d,[],DEFAULT_TURNO,at('13:00'),opts),b=ritmo(d,[],DEFAULT_TURNO,at('13:00'),{...opts,perfil});
 assert.equal(a.trozosProy,b.trozosProy);assert.equal(b.m3TeoProy,a.m3TeoProy*.9875);assert.ok(Math.abs(b.m3RealProy-b.m3TeoProy*(60/(75*.9)))<1e-9);
 assert.equal(ritmo({trozosPLC:0},[],DEFAULT_TURNO,at('13:00'),{...opts,perfil}).m3RealProy,null);
});
test('datos: prioridad, limites, error y sensor dentro y fuera del turno',()=>{
 const base={ahora:at('14:00'),conectado:true,ultimoContacto:at('13:59'),hoyConsultado:at('13:55'),intervaloMin:5,enTurno:true,sensor:{estado:'OK',visto:at('13:59')}};
 assert.equal(estadoDatos(base).nivel,'ok');assert.equal(estadoDatos({...base,conectado:false}).nivel,'ok');
 const offline=estadoDatos({...base,conectado:false,ultimoContacto:at('13:58')});assert.equal(offline.nivel,'critico');assert.equal(offline.desde.getTime(),at('13:58').getTime());assert.match(offline.mensaje,/13:58.*2 min/);
 const stale=estadoDatos({...base,hoyConsultado:at('13:40'),error:'Error sintetico'});assert.equal(stale.nivel,'critico');assert.ok(stale.mensaje.endsWith('Error sintetico'));
 for(const estado of ['Sin se\u00f1al','Sin sensor']){assert.equal(estadoDatos({...base,sensor:{estado,visto:at('13:59')}}).nivel,'aviso');assert.equal(estadoDatos({...base,enTurno:false,sensor:{estado}}).nivel,'ok');}
 assert.equal(estadoDatos({...base,sensor:{estado:'OK',visto:at('13:49')}}).nivel,'aviso');
});
