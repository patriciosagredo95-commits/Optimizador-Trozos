import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {normalizeConfig,armMain} from '../dist/optimizer.js';
import {planHeadline,assemblyRows,planTable,commonAssemblyWidth,comparisonRows,alternativeSummary,sameCuttingConfig} from '../dist/order-view.js';

const candidate=(cutting={},totals={})=>({config:normalizeConfig({cutting}),rows:[],totals:{piecesA:100,volumeM3:12,yieldPercent:60,...totals}});
const tableRows=html=>[...html.matchAll(/<tr><th scope="row">([^<]+)<\/th><td>(.*?)<\/td><td>(.*?)<\/td><\/tr>/g)];

// Geometry is checked from the output consumed by the browser, including rounding.
test('actual, recomendado y alternativas comparten escala, se centran y quedan dentro de 0–100 %',()=>{
  const candidates=[candidate({m:3,med:false,x1:48}),candidate({m:9,med:false}),candidate({m:6,med:true,a:26,c:2}),candidate({m:0,med:false})];
  const maxWidth=commonAssemblyWidth(candidates);
  const html=assemblyRows(candidates.map((item,i)=>({label:i?`Alternativa ${i+1}`:'Actual',candidate:item})),maxWidth);
  const bodies=[...html.matchAll(/class="arm-body" style="width:([\d.]+)%"[^>]*>(.*?)<\/div>/g)];
  assert.equal(bodies.length,candidates.length);
  assert.equal(Math.max(...bodies.map(match=>Number(match[1]))),100);
  for(const [i,body] of bodies.entries()){
    const arm=armMain(candidates[i].config.cutting);
    assert.equal(Number(body[1]),Number((arm.X/maxWidth*100).toFixed(2)));
    const pieces=[...body[2].matchAll(/style="left:([\d.]+)%;width:([\d.]+)%"/g)];
    assert.equal(pieces.length,arm.seq.length);
    for(const [j,piece] of pieces.entries()){
      const left=Number(piece[1]),width=Number(piece[2]),source=arm.seq[j];
      assert.equal(left,Number(((source.u0+arm.X/2)/arm.X*100).toFixed(2)));
      assert.equal(width,Number((source.w/arm.X*100).toFixed(2)));
      assert.ok(left>=0&&left+width<=100,`${left} + ${width}`);
    }
    assert.ok(Math.abs(Number(pieces[0][1])-(100-Number(pieces.at(-1)[1])-Number(pieces.at(-1)[2])))<=.011);
  }
  assert.doesNotMatch(html,/<svg|preserveAspectRatio|rotate\(/);
});

test('dibujo: espesores horizontales, sin leyenda ni notas y descripción accesible por grupos',()=>{
  const current=candidate({m:3,med:false,x1:48}),other=candidate({m:4,med:true,a:26.5,c:2});
  const entries=[{label:'Actual',candidate:current},{label:'Recomendado',candidate:other}];
  const html=assemblyRows(entries,commonAssemblyWidth([current,other]));
  assert.match(html,/aria-label="Actual: 2 tablas de clasificación de 22 mm, 3 piezas principales de 48 mm, 2 tablas de clasificación de 22 mm"/);
  assert.match(html,/title="Tabla central 26,5 mm">26,5<\/span>/);
  assert.match(html,/class="arm-piece arm-principal"/);
  assert.match(html,/class="arm-piece arm-clasificacion"/);
  assert.match(html,/class="arm-piece arm-central"/);
  assert.doesNotMatch(html,/<i class=|arm-legend|arm-caption|Vista de frente/);
  const withoutCentral=assemblyRows([entries[0]],commonAssemblyWidth([current]));
  assert.doesNotMatch(withoutCentral,/arm-central|Tabla central/);
  const onlyClassification=candidate({m:0,med:false});
  assert.doesNotMatch(assemblyRows([{label:'Actual',candidate:onlyClassification}],commonAssemblyWidth([onlyClassification])),/arm-principal/);
});

test('titular principal: conclusión, porcentaje y las otras dos métricas',()=>{
  const current=candidate({}, {piecesA:2900,volumeM3:12,yieldPercent:60});
  const other=candidate({}, {piecesA:5200,volumeM3:11.78,yieldPercent:59.9});
  assert.equal(planHeadline(current,other,'principal','este armado'),'<p class="plan-headline better">Con este armado el lote da <strong>2.300 piezas principales más</strong> (+79,3 %).</p><p class="plan-secondary">Volumen aserrado −0,22 m³ · Rendimiento −0,1 puntos</p>');
  assert.match(planHeadline(other,current,'principal','esta alternativa'),/class="plan-headline worse">Con esta alternativa el lote da <strong>2.300 piezas principales menos<\/strong> \(−44,2 %\)/);
  assert.match(planHeadline(current,current,'principal','este armado'),/class="plan-headline equal">Este armado da las mismas piezas principales que tu armado actual\./);
});

test('titular volumen: respeta el objetivo aunque bajen las piezas y redondea antes de comparar',()=>{
  const current=candidate({}, {volumeM3:160}),other=candidate({}, {piecesA:80,volumeM3:163.2});
  const html=planHeadline(current,other,'volume','esta alternativa');
  assert.match(html,/class="plan-headline better">Con esta alternativa el lote da <strong>3,20 m³ más<\/strong> de volumen aserrado \(\+2,0 %\)/);
  assert.match(html,/Piezas principales −20 \(−20,0 %\) · Rendimiento Sin cambio/);
  assert.match(planHeadline(other,current,'volume','este armado'),/class="plan-headline worse".*3,20 m³ menos/);
  assert.match(planHeadline(current,candidate({},{volumeM3:160.004}),'volume','esta alternativa'),/class="plan-headline equal">Esta alternativa da el mismo volumen aserrado/);
  const zero=candidate({},{piecesA:0,volumeM3:0});
  assert.doesNotMatch(planHeadline(zero,other,'volume','este armado'),/Infinity|NaN/);
  assert.doesNotMatch(planHeadline(zero,other,'principal','este armado'),/Infinity|NaN/);
});

test('tabla de planta: tres columnas, solo ajustes de planta y marcas solo en lo que cambia',()=>{
  const current=candidate({m:4,x1:48,med:false,e1:60,e2:75,cm:'75'});
  const other=candidate({m:6,x1:50,med:true,c:2,a:26,e1:60,e2:60,cm:'60'});
  const html=planTable(current,other,'Alternativa 2'),rows=tableRows(html);
  assert.match(html,/<div class="table-scroll"><table class="plan-table"><caption>Qué cambia en la planta<\/caption>/);
  assert.match(html,/<th scope="col"><\/th><th scope="col">Actual<\/th><th scope="col">Alternativa 2<\/th>/);
  assert.doesNotMatch(html,/plan-group|Resultado del lote|plan-note|plan-delta|Volumen aserrado/);
  assert.equal(rows.length,3);
  assert.equal(rows[0][2],'4 de 48 mm');
  assert.equal(rows[0][3],'<mark>6</mark> de <mark>50</mark> mm');
  assert.equal(rows[1][2],'Sin encerrar');
  assert.equal(rows[1][3],'<mark>Encerrada con 2 tablas de 26 mm</mark>');
  assert.equal(rows[2][2],'60 / 75 / 75 mm');
  assert.equal(rows[2][3],'60 / <mark>60</mark> / <mark>60</mark> mm');
  assert.ok(rows.every(row=>!row[2].includes('<mark>')));
  const same=planTable(current,current);
  assert.doesNotMatch(same,/<mark>/);
  assert.deepEqual(tableRows(same).map(row=>row[1]),['Piezas principales en la múltiple','Canteadora (extremo / centro / extremo)'],'la médula solo aparece si cambia');
  const countOnly=tableRows(planTable(current,candidate({...current.config.cutting,m:6})));
  assert.equal(countOnly[0][3],'<mark>6</mark> de 48 mm');
});

test('canteadora marca cada número por separado, usando el ancho real del centro',()=>{
  const current=candidate({x1:22,cm:'y1',y1:75,e1:60,e2:75,med:false});
  for(const [cutting,expected] of [
    [{cm:'75'},'60 / 75 / 75 mm'],
    [{e1:75},'<mark>75</mark> / 75 / 75 mm'],
    [{cm:'otro',cw:80},'60 / <mark>80</mark> / 75 mm'],
    [{e2:60},'60 / 75 / <mark>60</mark> mm'],
    [{e1:75,cm:'60',e2:60},'<mark>75</mark> / <mark>60</mark> / <mark>60</mark> mm'],
  ]){
    const other=candidate({...current.config.cutting,...cutting});
    assert.equal(tableRows(planTable(current,other)).find(row=>row[1].startsWith('Canteadora'))[3],expected);
  }
});

test('resultados: mejora, disminución e igualdad con signos, unidades y precisión de pantalla',()=>{
  const current=candidate(),other=candidate({}, {piecesA:110,volumeM3:11.78,yieldPercent:60});
  const rows=comparisonRows(current,other);
  assert.deepEqual(rows.map(row=>row.trend),['better','worse','equal']);
  assert.deepEqual(rows.map(row=>row.difference),['+10 (+10,0 %)','−0,22 m³','Sin cambio']);
  assert.equal(rows[1].current,'12,00 m³');
  assert.equal(rows[2].recommended,'60,0 %');
  assert.equal(comparisonRows(current,candidate({},{yieldPercent:60.2}))[2].difference,'+0,2 puntos');
  assert.equal(comparisonRows(current,candidate({},{yieldPercent:null}))[2].difference,'—');
  assert.equal(comparisonRows(current,candidate({},{yieldPercent:59.99}))[2].trend,'equal');
});

test('alternativas comparan contra el actual en palabras de planta según el objetivo',()=>{
  const current=candidate(),other=candidate({m:7,med:false,x1:50},{piecesA:1890,volumeM3:15.2});
  assert.equal(alternativeSummary(other,current,1,'principal'),'Alternativa 2 · 7 piezas principales de 50 mm · +1.790 piezas principales');
  assert.equal(alternativeSummary(other,current,1,'volume'),'Alternativa 2 · 7 piezas principales de 50 mm · +3,20 m³');
  assert.match(alternativeSummary(current,other,2,'volume'),/Alternativa 3.*−3,20 m³/);
  assert.match(alternativeSummary(current,current,1),/Sin cambio$/);
});

test('salida sin códigos de configuración y con rótulos escapados',()=>{
  const current=candidate(),other=candidate({m:8,med:true,e1:60,e2:75,cm:'y1',x1:22});
  const html=[planHeadline(current,other,'principal','esta alternativa'),assemblyRows([{label:'Actual',candidate:current},{label:'Alternativa 2',candidate:other}],commonAssemblyWidth([current,other])),planTable(current,other),alternativeSummary(other,current,1)].join('');
  assert.doesNotMatch(html,/\be1\b|\be2\b|\bX1\b|\bcm\b|<svg|preserveAspectRatio|rotate\(/);
  assert.match(planTable(current,other,'<otro>'),/&lt;otro&gt;/);
  assert.match(assemblyRows([{label:'<Actual>',candidate:current}],commonAssemblyWidth([current])),/&lt;Actual&gt;/);
});

test('igualdad de armado considera todas las claves de corte',()=>{
  assert.equal(sameCuttingConfig(candidate(),candidate()),true);
  assert.equal(sameCuttingConfig(candidate(),candidate({e2:60})),false);
  assert.equal(sameCuttingConfig(candidate(),candidate({y3:80})),false);
});

test('paso 3 integra titular, comparación, alternativas cerradas y acciones con sus índices',()=>{
  const source=readFileSync(new URL('../dist/app.js',import.meta.url),'utf8');
  const render=source.slice(source.indexOf('function renderRecommendation(){'),source.indexOf('function recommendArmado(){'));
  const result={innerHTML:'',querySelectorAll:()=>[]};
  const current=candidate(),best=candidate({m:8},{piecesA:200}),other=candidate({m:6},{piecesA:180});
  const context=vm.createContext({state:{recommendation:{current,candidates:[best,other],objective:'principal'}},$:()=>result,escapeHTML:value=>value,planHeadline,assemblyRows,planTable,commonAssemblyWidth,alternativeSummary,sameCuttingConfig});
  vm.runInContext(render+';renderRecommendation();',context);
  assert.match(result.innerHTML,/class="recommended-armado"><p class="plan-headline better"/);
  assert.match(result.innerHTML,/data-use-armado="0">Usar este armado/);
  assert.match(result.innerHTML,/<h4 class="plan-alternatives-heading">Otras opciones<\/h4><details><summary>Alternativa 2/);
  assert.match(result.innerHTML,/data-use-armado="1">Usar esta alternativa/);
  assert.equal((result.innerHTML.match(/class="arm-row-label">Actual/g)||[]).length,2);
  assert.equal((result.innerHTML.match(/<caption>Qué cambia/g)||[]).length,2);
  assert.doesNotMatch(result.innerHTML,/<details open/);
  context.state.recommendation.candidates=[current];
  vm.runInContext('renderRecommendation();',context);
  assert.match(result.innerHTML,/<p class="order-positive">Tu armado actual ya es el mejor para este pedido\.<\/p>/);
  assert.doesNotMatch(result.innerHTML,/plan-headline|data-use-armado/);
  assert.match(result.innerHTML,/class="arm-compare"/);
  assert.match(result.innerHTML,/class="plan-table"/);
});
