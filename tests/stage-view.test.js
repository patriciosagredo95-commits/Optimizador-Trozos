import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createOptimizer,DIAMETERS} from '../dist/optimizer.js';
import {stageSVG,stageViewModel,stageLabelLayout,stagePieceListHTML,stageOutputsHTML,productionLegend,DESTINATION_STYLES,cuttingScheme,printSheet,stageSummary,stagePieceGroups,compactNumbers} from '../dist/reports.js';
import {stageLegendHTML} from '../dist/stage-view.js';

const overlaps=(a,b)=>a.x0<b.x1&&a.x1>b.x0&&a.y0<b.y1&&a.y1>b.y0;
const configurations=[{},
  {cutting:{x1:22,y1:100,x2:22,y2:75,x3:22,y3:60,a:22,c:2,m:4,cm:'y1'}},
  {cutting:{x1:55,y1:75,x2:22,y2:75,x3:22,y3:60,a:22,m:4}}
];

test('presentación: cada número tiene medidas, destino y espacio, en todo el catálogo y ambas alternativas',()=>{
  let views=0,labels=0;
  for(const config of configurations){
    const engine=createOptimizer(config);
    for(const diameter of DIAMETERS){
      const result=engine.solve(diameter);
      for(const alternative of result.alternatives){
        const before=JSON.stringify(alternative);
        for(const stage of [1,2,3,4,0]){
          const {model,scale,labels:placed,extent,chain,dimensions}=stageLabelLayout(alternative,stage,engine.config),svg=stageSVG(alternative,engine.config,stage,`d-${diameter}-s-${stage}`),key=stagePieceListHTML(alternative,stage),groups=stagePieceGroups(alternative,stage);
          views++;labels+=placed.length;
          assert.equal(placed.length,model.items.length,`Ø ${diameter}, etapa ${stage}`);
          assert.equal(new Set(placed.map(label=>label.number)).size,placed.length);
          assert.equal((svg.match(/data-stage-piece=/g)??[]).length,model.items.length);
          assert.equal((svg.match(/data-label=/g)??[]).length,model.items.length);
          assert.match(key,/<details[^>]* open>/);
          assert.equal((key.match(/<li value=/g)??[]).length,groups.length);
          assert.deepEqual(groups.flatMap(group=>group.numbers).sort((a,b)=>a-b),model.items.map(item=>item.number));
          assert.equal((svg.match(/data-arm-width=/g)??[]).length,chain.length);
          for(const [i,dimension] of dimensions.entries()){
            const b=dimension.box;
            assert.ok(b.x0>=-extent&&b.x1<=extent&&b.y0>=-342&&b.y1<=286);
            assert.ok(!placed.some(label=>overlaps(b,label.box)),`Cota con número: Ø ${diameter}, etapa ${stage}`);
            assert.ok(!dimensions.slice(i+1).some(other=>overlaps(b,other.box)),`Cotas: Ø ${diameter}, etapa ${stage}`);
          }
          assert.ok(!/NaN|undefined/.test(svg+key+stageOutputsHTML(alternative,stage)));
          for(const item of model.items){
            assert.ok(item.measure.includes('mm')||item.measure.includes('variable'));
            assert.ok(DESTINATION_STYLES[item.destination]);
            assert.ok(groups.some(group=>group.numbers.includes(item.number)&&key.includes(`value="${group.number}"`)));
            assert.ok(svg.includes(`data-stage-piece="${item.number}"`));
          }
          for(const [index,label] of placed.entries()){
            const b=label.box,item=model.items[label.number-1];
            assert.ok(b.x0>=-extent&&b.x1<=extent&&b.y0>=-286&&b.y1<=286);
            assert.ok(!placed.slice(index+1).some(other=>overlaps(b,other.box)),`Ø ${diameter}, etapa ${stage}, Nº ${label.number}`);
            if(label.external){
              assert.ok(label.anchor.x**2+label.anchor.y**2<=220**2+.001);
              assert.ok(label.anchor.x>=item.g.x0*scale-.001&&label.anchor.x<=item.g.x1*scale+.001);
              assert.ok(label.anchor.y>=-item.g.y1*scale-.001&&label.anchor.y<=-item.g.y0*scale+.001);
            }else{
              assert.ok(b.x0>=item.g.x0*scale-.001&&b.x1<=item.g.x1*scale+.001);
              assert.ok(b.y0>=-item.g.y1*scale-.001&&b.y1<=-item.g.y0*scale+.001);
              for(const x of [b.x0,b.x1])for(const y of [b.y0,b.y1])assert.ok(x*x+y*y<=220*220+.001);
            }
          }
          const currentMachine=['','carriage','bands','multiple','edger'][stage];
          assert.ok(model.cuts.every(cut=>cut.active===(stage!==0&&cut.machine===currentMachine)));
          assert.match(svg,/stroke-dasharray="3 3"|data-cut-state="current"/);
          for(const [destination,,count] of productionLegend(alternative,stage))assert.equal(count,[...model.items,...model.context].filter(item=>(item.destination==='bypass'?'bypass':item.enclosesPith?'pith':item.destination)===destination).length);
        }
        assert.equal(JSON.stringify(alternative),before,'La presentación no modifica los datos del motor');
      }
    }
  }
  assert.equal(views,630);
  assert.ok(labels>5000);
});

test('cantidades y secciones: productos finales y salidas de canteadora corresponden al resultado calculado',()=>{
  for(const config of configurations){
    const engine=createOptimizer(config);
    for(const diameter of DIAMETERS){
      const result=engine.solve(diameter),final=stageViewModel(result,0),bands=stageViewModel(result,2),edger=stageViewModel(result,4);
      const finished=final.items.filter(item=>item.destination==='finished');
      assert.equal(finished.length,result.pieces.length);
      assert.equal(new Set(finished.map(item=>item.pieceIndex)).size,result.pieces.length);
      for(const item of finished){
        assert.ok(item.pieceIndex>=0);
        const piece=result.pieces[item.pieceIndex],product=result.products[piece.productId];
        assert.ok(Math.abs(item.thickness-product.thickness)<.000001);
        assert.ok(Math.abs(item.width-product.width)<.000001);
      }
      assert.equal(bands.items.filter(item=>item.destination==='toMultiple').length,result.cutting.bodies.filter(body=>!body.empty).length);
      assert.equal(bands.items.filter(item=>item.destination==='cantInput').length,result.cutting.boards.length);
      assert.equal(edger.items.filter(item=>item.source==='edger'&&item.destination==='finished').length,result.cutting.cant.reduce((sum,board)=>sum+board.plan.length,0));
      assert.equal(edger.items.filter(item=>item.source==='edger'&&item.destination==='lost').length,result.cutting.cant.filter(board=>!board.ok).length);
      for(const item of edger.items.filter(item=>item.source==='edger'&&item.width===0)){
        assert.match(item.measure,/sin ancho útil/);
        assert.ok(!/× 0 mm/.test(item.measure));
      }
      assert.ok(!/Y[123]|posiciones|F =/.test(cuttingScheme(result)));
    }
  }
});

test('accesibilidad y ficha compartida: números visibles, ayuda con teclado y dibujo legible al imprimir',()=>{
  const engine=createOptimizer(),result=engine.solve(16),svg=stageSVG(result,engine.config,4,'accessible');
  assert.match(svg,/<title id=/);
  assert.match(svg,/aria-labelledby=/);
  assert.match(svg,/data-tip="[^"]+" aria-label=/);
  assert.match(svg,/tabindex="0" role="button" data-piece=/);
  assert.match(svg,/patternUnits="userSpaceOnUse"/);
  assert.ok(!svg.includes('#C8322A'));
  const app=readFileSync(new URL('../dist/app.js',import.meta.url),'utf8');
  for(const event of ['focusin','focusout','pointermove'])assert.ok(app.includes(`addEventListener('${event}'`));
  assert.ok(app.includes("event.key==='Escape'"));
  const html=readFileSync(new URL('../dist/index.html',import.meta.url),'utf8');
  assert.match(html,/data-stage="0"[^>]*><span[^>]*>5<\/span>/);
  assert.match(html,/class="button-row" hidden style="display:none"><button id="save-config"/);
  const css=readFileSync(new URL('../dist/styles.css',import.meta.url),'utf8');
  assert.ok(css.includes('max-width:165mm;width:165mm'));
  const sheet=printSheet(result,engine.config);
  assert.equal((sheet.match(/<svg /g)??[]).length,5);
  assert.equal((sheet.match(/class="stage-piece-key" open/g)??[]).length,5);
  assert.equal((sheet.match(/Qué sale de esta máquina/g)??[]).length,8);
});

test('secciones decimales: máximo un decimal visible y precisión calculada en la ayuda',()=>{
  const engine=createOptimizer({cutting:{x1:50.123,y1:100.456,y2:75.42,y3:75.44}}),result=engine.solve(56);
  const model=stageViewModel(result,0),principal=model.items.find(item=>item.name==='Medida principal');
  assert.ok(principal);
  assert.match(principal.measure,/50,1 × 100,5 mm/);
  assert.match(principal.tip,/50,123 × 100,456 mm/);
  assert.ok(stageOutputsHTML(result,0).includes(principal.measure));
  assert.ok(stagePieceListHTML(result,0).includes(principal.measure));
});

test('agrupación: nombre, medida mostrada y destino; rangos y orden por primer número',()=>{
  assert.equal(compactNumbers([1,2,7,8,9,10,15,16,17,18,23,24]),'1, 2, 7–10, 15–18, 23, 24');
  const result=createOptimizer().solve(42),items=stageViewModel(result,0).items,groups=stagePieceGroups(result,0);
  assert.equal(items.length,42);
  assert.ok(groups.length<items.length/2);
  assert.deepEqual(groups.map(g=>g.number),groups.map(g=>g.number).sort((a,b)=>a-b));
  for(const group of groups){
    const matching=items.filter(i=>i.name===group.name&&i.measure===group.measure&&i.destination===group.destination&&!!i.enclosesPith===!!group.enclosesPith);
    assert.deepEqual(group.numbers,matching.map(i=>i.number));
    assert.ok(stagePieceListHTML(result,0).includes(`${group.numbers.length} × ${group.name}`));
  }
});

test('cada máquina numera solo su producción y conserva el contexto atenuado y accesible',()=>{
  const engine=createOptimizer(),result=engine.solve(42);
  for(const stage of [3,4]){
    const view=stageViewModel(result,stage),svg=stageSVG(result,engine.config,stage);
    assert.ok(view.context.length);
    assert.ok(view.context.every(i=>i.number===null&&i.destination==='bypass'));
    assert.ok(view.items.every((i,index)=>i.number===index+1&&i.source===(stage===3?'multiple':'edger')));
    assert.ok(svg.includes('data-stage-context="true"'));
    assert.ok(svg.includes('opacity=".42"'));
    assert.ok(productionLegend(result,stage).some(([key])=>key==='bypass'));
    assert.ok(!stagePieceListHTML(result,stage).includes('desde huinchas'));
  }
  assert.equal(stageViewModel(result,0).context.length,0);
});

test('armados calculados: orden de sierra, corte y salidas iguales en pantalla y ficha',()=>{
  const engine=createOptimizer(),result=engine.solve(42);
  for(const [stage,widths] of [[3,[22,22,50,26,26,50,22,22]],[4,[60,75,75]]]){
    const layout=stageLabelLayout(result,stage,engine.config);
    assert.deepEqual(layout.chain.map(q=>q.width),widths);
    const text=`Armado: ${widths.join(' · ')} mm; cada corte 4,2 mm`;
    assert.ok(stageOutputsHTML(result,stage,engine.config).includes(text));
    assert.ok(printSheet(result,engine.config).includes(text));
  }
});

test('resúmenes: omiten cantidades cero y distinguen origen y singular',()=>{
  const result=createOptimizer().solve(42);
  assert.match(stageSummary(result,4),/8 tablas de lampazo/);
  assert.ok(!stageSummary(result,4).includes('de la múltiple'));
  for(const stage of [0,1,2,3,4])assert.ok(!/\b0 (?:tabla|pieza|basa|semibasa)/.test(stageSummary(result,stage)));
  const one=structuredClone(result);
  one.cutting.boards=one.cutting.boards.slice(0,1);
  one.cutting.cant=one.cutting.cant.slice(0,1);
  assert.match(stageSummary(one,4),/1 tabla de lampazo/);
  assert.ok(!stageSummary(one,4).includes('1 tablas'));
  const none=structuredClone(result);
  none.cutting.boards=[];none.cutting.cant=[];
  assert.match(stageSummary(none,4),/Sin tablas para cantear/);
  assert.ok(!stageSummary(none,2).includes('lampazo'));
  const mixed=structuredClone(one);
  mixed.cutting.boards=[];
  assert.match(stageSummary(mixed,4),/1 tabla de la múltiple/);
  assert.ok(!stageSummary(mixed,4).includes('lampazo'));
});

test('medidas visibles: enteros limpios y 75 distinto de 75,4',()=>{
  const engine=createOptimizer({cutting:{e1:75,e2:75,cm:'otro',cw:75.4}}),result=engine.solve(50);
  const groups=stagePieceGroups(result,4);
  assert.ok(groups.some(g=>g.measure==='22 × 75 mm'));
  assert.ok(groups.some(g=>g.measure==='22 × 75,4 mm'));
  for(const stage of [0,1,2,3,4]){
    for(const item of stageViewModel(result,stage).items)assert.ok(!/\d,\d{2,}/.test(item.measure));
  }
});


test('médula: las c tablas centrales pertenecen solo a la basa que contiene el centro; Sí y No en todo el catálogo',()=>{
  for(const med of [true,false])for(const c of [1,2,3,4,5,6]){
    const engine=createOptimizer({cutting:{med,c,a:22,x1:48,m:6}});
    for(const diameter of DIAMETERS)for(const result of engine.solve(diameter).alternatives){
      const before=JSON.stringify(result);
      // Las bases del contrato público están expresadas en coordenadas x/y.
      const containing=result.bases.findIndex(b=>b.x0<=0&&b.x1>=0&&b.y0<=0&&b.y1>=0);
      const expected=med&&containing>=0?result.cutting.bodies[containing].pieces.filter(p=>p.t==='a'&&p.st!=='empty'):[];
      for(const stage of [1,2,3,4,0]){
        const view=stageViewModel(result,stage),layout=stageLabelLayout(result,stage,engine.config);
        const svg=stageSVG(result,engine.config,stage,'pith-check');
        const marked=view.items.filter(i=>i.enclosesPith);
        assert.equal((svg.match(/data-pith-marker="true"/g)??[]).length,1);
        assert.ok(stageLegendHTML(result,stage).includes('>Médula</span>'));
        for(const label of layout.labels)assert.ok(!overlaps(label.box,{x0:-6,x1:6,y0:-6,y1:6}));
        assert.equal(marked.length,stage===3||stage===0?expected.length:0);
        assert.equal((svg.match(/data-appearance="pith"/g)??[]).length,marked.length);
        if(!marked.length)assert.ok(!svg.includes(DESTINATION_STYLES.pith.color));
        assert.equal(productionLegend(result,stage).find(([key])=>key==='pith')?.[2]??0,marked.length);
        for(const item of marked){
          assert.match(item.tip,/encierra la médula/);
          assert.ok(expected.some(p=>Math.abs((result.cutting.bodies[containing].o==='xu'?item.g.x0:item.g.y0)-p.u0)<.001));
        }
        if(marked.length){
          assert.match(stageOutputsHTML(result,stage),/encierra la médula/);
          assert.match(stagePieceListHTML(result,stage),/encierra la médula/);
        }
        for(const group of stagePieceGroups(result,stage))assert.ok(group.numbers.every(n=>!!view.items[n-1].enclosesPith===!!group.enclosesPith));
        if(stage===4){
          assert.equal(view.context.filter(i=>i.enclosesPith).length,expected.length);
          assert.ok(view.context.every(i=>i.destination==='bypass'));
        }
      }
      assert.equal(JSON.stringify(result),before);
    }
  }
});

test('médula: ejemplo Ø 42, corte entre dos centrales, trama propia y cinco marcadores en la ficha',()=>{
  const engine=createOptimizer({cutting:{med:true,a:22,c:2,x1:48,m:6}}),result=engine.solve(42);
  const view=stageViewModel(result,0),marked=view.items.filter(i=>i.enclosesPith);
  assert.equal(marked.length,2);
  assert.ok(marked.every(i=>i.name==='Tabla central'&&i.thickness===22));
  assert.ok(marked.some(i=>i.g.x1<0)&&marked.some(i=>i.g.x0>0));
  assert.ok(marked.every(i=>i.g.y0<0&&i.g.y1>0));
  assert.ok(view.items.some(i=>i.name==='Tabla central'&&!i.enclosesPith));
  assert.equal(new Set(Object.values(DESTINATION_STYLES).map(s=>s.color)).size,Object.keys(DESTINATION_STYLES).length);
  assert.equal(DESTINATION_STYLES.pith.pattern,'rings');
  const sheet=printSheet(result,engine.config);
  assert.equal((sheet.match(/data-pith-marker="true"/g)??[]).length,5);
  assert.equal((sheet.match(/data-appearance="pith"/g)??[]).length,4);
  assert.match(sheet,/<circle cx="4" cy="4" r="2.3" fill="none"/);
  assert.match(sheet,/Encierran la médula/);
  assert.match(sheet,/encierra la médula/);
});

test('médula entre basas: no se destacan las tablas centrales de las basas vecinas',()=>{
  const result=createOptimizer().solve(46);
  assert.ok(result.bases.every(b=>!(b.x0<=0&&b.x1>=0&&b.y0<=0&&b.y1>=0)));
  assert.ok(stageViewModel(result,0).items.some(i=>i.name==='Tabla central'));
  assert.ok(stageViewModel(result,0).items.every(i=>!i.enclosesPith));
});
