import {planHeadline,assemblyRows,planTable,commonAssemblyWidth,alternativeSummary,sameCuttingConfig} from './order-view.js';
import {formatPercent} from './format.js';
import {DIAMETERS,normalizeConfig} from './optimizer.js';
import {stageSVG,cutSequence,resultsCSV,printSheet,historicalComparison,activeProducts,escapeHTML,configurationFile,parseConfiguration,restoreConfiguration,STORAGE_KEY,CLASS_COLORS,cuttingScheme,stageLegendHTML,stagePieceListHTML,stageOutputsHTML,stageSummary} from './reports.js';
import {bestYieldAlternative,simulateOrder} from './order.js';
import {CUTTING_DEFAULTS,normalizeCuttingConfig,eqT,armMain,suggestM} from './optimizer.js';
import {normalizeLot} from './run-planner.js';
import {candidateToSidebar} from './armado.js';
import {buildMachineInstructions} from './machine-instructions.js';
import {MACHINES,machineSheets,machineCSV} from './machine-reports.js';
import {compute} from './optimizer.js';

const $=id=>document.getElementById(id);
const fmt=(n,d=0)=>new Intl.NumberFormat('es-CL',{minimumFractionDigits:d,maximumFractionDigits:d}).format(n);
const dimensions=p=>`${fmt(p.thickness,p.thickness%1?1:0)} × ${fmt(p.width,p.width%1?1:0)}`;
const largeFields=['x1','y1','x2','y2','x3','y3','a','c','m','e1','e2','cm','cw'];
function readLargeConfig(){
  const p=Object.fromEntries(largeFields.map(key=>[key,$(`large-${key}`).value]));
  p.med=$('large-med').value==='yes';p.referenceDiameter=Number($('reference-diameter').value);
  if(eqT({...p,x1:Number(p.x1),x2:Number(p.x2),x3:Number(p.x3)}))p.m=Number($('large-n').value)-4-(p.med?Number(p.c):0);
  return normalizeCuttingConfig(p);
}
function syncLargeControls(){
  const p=Object.fromEntries(largeFields.map(key=>[key,key==='cm'?$(`large-${key}`).value:Number($(`large-${key}`).value)]));
  p.med=$('large-med').value==='yes';
  const same=eqT(p);$('large-m-field').hidden=same;$('large-n-field').hidden=!same;
  $('large-med-fields').hidden=!p.med;$('large-m').step=p.med?'2':'1';$('large-n').step=p.med?'2':'1';
  $('large-cm').querySelector('[value="y1"]').disabled=p.x1!==22;
  if(p.x1!==22&&p.cm==='y1')$('large-cm').value='75';
  $('large-cw-field').hidden=$('large-cm').value!=='otro';
  try{
    const config=readLargeConfig(),arm=armMain(config);
    renderArmPreviews(config,arm);
    $('large-arm-summary').textContent=`${arm.seq.length} piezas · ancho X = ${fmt(arm.X,1)} mm · 2 × 22 en cada extremo`;
    const suggested=suggestM({...config,d:config.referenceDiameter});
    $('large-suggestion').textContent=`Referencia Ø ${config.referenceDiameter} cm: m sugerido = ${suggested}${eqT(config)?` · total N = ${suggested+4+(config.med?config.c:0)}`:''}.`;
    $('large-suggest').textContent=`Usar sugerencia de Ø ${config.referenceDiameter} cm`;$('large-suggest').disabled=false;
  }catch(error){$('multiple-preview').replaceChildren();$('edger-preview').replaceChildren();$('large-arm-summary').textContent=error.message;$('large-suggestion').textContent='Completa un armado válido para mostrar la sugerencia.';$('large-suggest').disabled=true;}
}
// Colores exclusivos de los mini diagramas de configuración.
const PREVIEW_COLORS={prin:'#9db5c8',med:'#dce5ec',clas:'#becbd5',cant:'#c5d6df'};
function renderArmPreviews(config,arm){
  const strip=(id,segments,total)=>{
    const description=segments.map(s=>`${s.label} ${fmt(s.width,1)} mm`).join(' · ');
    $(id).innerHTML=`<svg viewBox="0 0 ${total} 54" role="img" aria-label="${escapeHTML(description)}"><title>${escapeHTML(description)}</title>${segments.map(s=>`<rect x="${s.start}" y="4" width="${s.width}" height="34" fill="${PREVIEW_COLORS[s.cls]}" stroke="#34424b" stroke-width="0.6"/><text x="${s.start+s.width/2}" y="26" text-anchor="middle" fill="#152238" font-size="${Math.min(12,s.width*.55)}">${escapeHTML(s.label)}</text>`).join('')}</svg>`;
  };
  strip('multiple-preview',arm.seq.map(p=>({label:p.t==='22'?'22':p.t==='a'?'a':'X1',width:p.w,start:p.u0+arm.X/2,cls:p.t==='22'?'clas':p.t==='a'?'med':'prin'})),arm.X);
  const center=config.cm==='y1'?config.y1:config.cm==='otro'?config.cw:Number(config.cm);
  const widths=[config.e1,center,config.e2],labels=['e1','centro','e2'];
  let start=0;
  strip('edger-preview',widths.map((width,i)=>{const segment={label:labels[i],width,start,cls:i===1&&config.cm==='y1'?'prin':'cant'};start+=width+4.2;return segment;}),widths.reduce((a,b)=>a+b,0)+8.4);
}
function populateLargeConfig(config={}){
  const p={...CUTTING_DEFAULTS,...config};$('reference-diameter').value=p.referenceDiameter;largeFields.forEach(key=>$(`large-${key}`).value=p[key]);
  $('large-med').value=p.med?'yes':'no';$('large-n').value=Number(p.m)+4+(p.med?Number(p.c):0);syncLargeControls();
}
const state={results:new Map(),selected:42,snapshot:null,worker:null,runId:0,dirty:false,running:false,completion:null,selectedPiece:null,alternativeSelections:new Map()};
state.stage=0;state.historyKey=null;
state.activeTab='patterns';state.orderStock=Object.fromEntries(DIAMETERS.map(d=>[d,'0']));state.orderPlan=null;
state.recommendation=null;state.planWorker=null;state.planId=0;
function savedConfig(config=readConfig()){
  return {...config,lot:normalizeLot(state.orderStock),objective:$('recommend-objective').value};
}
function persistLot(){
  try{localStorage.setItem(STORAGE_KEY,JSON.stringify(savedConfig()));}catch{}
}
function invalidateRecommendation(){
  state.planId++;state.planWorker?.terminate();state.planWorker=null;state.recommendation=null;
  $('recommend-armado').disabled=false;$('recommend-result').replaceChildren();
  $('recommend-progress').textContent='';
}
const resultAlternatives=result=>result?.alternatives?.length?result.alternatives:result?.status==='found'?[result]:[];
const selectedAlternativeIndex=(d=state.selected)=>{
  const result=state.results.get(d),alternatives=resultAlternatives(result),saved=state.alternativeSelections.get(d);
  if(Number.isInteger(saved)&&saved>=0&&saved<alternatives.length)return saved;
  return Math.max(0,(bestYieldAlternative(result)?.alternative??1)-1);
};
const selectedResult=(d=state.selected)=>resultAlternatives(state.results.get(d))[selectedAlternativeIndex(d)]??state.results.get(d);

function readConfig(){
  return normalizeConfig({cutting:readLargeConfig(),length:$('length').value});
}
function populateConfig(config){
  const c=normalizeConfig(config);
  if(config.lot!==undefined){state.orderStock=normalizeLot(config.lot);renderOrderStockInputs();}
  if(config.objective!==undefined)$('recommend-objective').value=config.objective==='volume'?'volume':'principal';
  populateLargeConfig(c.cutting);
  $('length').value=c.length;
  markDirty();
}
function markDirty() {
  invalidateRecommendation();
  if(!state.snapshot&&!state.running)return;
  state.dirty=true;$('stale-banner').hidden=false;
  if(!state.running)$('run-caption').textContent='Actualiza los resultados con la nueva configuración.';
  invalidateOrderPlan();
}
function showError(message) {$('form-error').textContent=message;$('form-error').hidden=false;}

function showWorkspaceTab(tab){
  state.activeTab=tab;
  for(const name of ['patterns','order']){
    const selected=name===tab,button=$(`tab-${name}`);
    button.setAttribute('aria-selected',String(selected));button.tabIndex=selected?0:-1;
    $(`${name}-panel`).hidden=!selected;
  }
  if(tab==='patterns'&&state.results.has(state.selected))renderDiagram();
}
function updateOrderStock(diameter,value){
  state.orderStock[diameter]=value;invalidateRecommendation();invalidateOrderPlan();persistLot();
}
function refreshOrderStockSummary(){
  const quantities=Object.values(state.orderStock).map(Number).filter(q=>Number.isSafeInteger(q)&&q>0&&q<=10000);
  const total=quantities.reduce((sum,q)=>sum+q,0);
  $('order-stock-summary').textContent=total?`${fmt(total)} ${total===1?'trozo':'trozos'} en ${quantities.length} ${quantities.length===1?'diámetro':'diámetros'}`:'Aún no ingresas trozos';
}
$('order-clear-stock').addEventListener('click',()=>{
  for(const diameter of DIAMETERS)updateOrderStock(diameter,'0');
  renderOrderStockInputs();
});
function renderOrderStockInputs(){
  $('order-inventory-grid').replaceChildren();
  for(const diameter of DIAMETERS){
    const label=document.createElement('label');label.textContent=`${diameter} cm`;
    const input=document.createElement('input');
    Object.assign(input,{type:'number',min:'0',max:'10000',step:'1',value:state.orderStock[diameter]});
    input.setAttribute('aria-label',`Cantidad de trozos de ${diameter} centímetros`);
    label.classList.toggle('has-stock',Number(input.value)>0);
    input.addEventListener('input',()=>{updateOrderStock(diameter,input.value);label.classList.toggle('has-stock',Number(input.value)>0);refreshOrderStockSummary();});
    label.append(input);$('order-inventory-grid').append(label);
  }
  refreshOrderStockSummary();
}
function syncOrderMeta(){
  const c=state.snapshot;if(!c)return;
  $('order-b-metric').hidden=false;
  document.querySelectorAll('.order-b-cell').forEach(cell=>cell.hidden=false);
}
function refreshOrderStatus(){
  const ready=!!state.snapshot&&!state.running&&!state.dirty&&state.results.size===DIAMETERS.length;
  $('simulate-order').disabled=!ready;$('order-stale').hidden=!state.dirty;
  $('order-notice').textContent=state.running?'Calculando los patrones de todos los diámetros…':state.dirty?'Vuelve a optimizar los parámetros de corte para simular el pedido.':!ready?'Esperando los patrones de todos los diámetros.':state.orderPlan?'Simulación calculada con los patrones actuales.':'Ingresa los trozos y pulsa Calcular producción.';
}
function invalidateOrderPlan(){
  state.orderPlan=null;$('order-results').hidden=true;refreshOrderStatus();
}
function renderOrderPlan(){
  const plan=state.orderPlan;if(!plan)return;
  const {totals}=plan;
  const noPatternLogs=plan.rows.filter(row=>row.status==='no_pattern').reduce((sum,row)=>sum+row.availableLogs,0);
  const message=totals.usedLogs?`Se procesan ${fmt(totals.usedLogs)} de ${fmt(totals.availableLogs)} trozos disponibles${noPatternLogs?`; ${fmt(noPatternLogs)} no tienen patrón de corte`:''}.`:'Los trozos ingresados no tienen un patrón de corte disponible.';
  $('order-fulfillment').textContent=message;
  $('order-fulfillment').classList.toggle('warning',!totals.usedLogs||noPatternLogs>0);
  $('order-total-logs').textContent=`${fmt(totals.usedLogs)} / ${fmt(totals.availableLogs)}`;
  $('order-total-a').textContent=fmt(totals.piecesA);
  $('order-total-b').textContent=fmt(totals.piecesB);$('order-total-c').textContent=fmt(totals.piecesC);
  $('order-total-volume').textContent=`${fmt(totals.volumeM3,2)} m³`;
  $('order-total-yield').textContent=totals.yieldPercent==null?'—':formatPercent(totals.yieldPercent);
  const chartRows=plan.rows.filter(row=>row.availableLogs>0);
  const highestYield=Math.max(0,...chartRows.map(row=>row.yieldPercent??0));
  const axisMax=Math.min(100,Math.max(60,Math.ceil(highestYield/10)*10));
  $('order-chart-count').textContent=`${chartRows.length} ${chartRows.length===1?'diámetro':'diámetros'} · ${fmt(totals.availableLogs)} trozos`;
  $('order-chart-main').style.setProperty('--bar-count',String(chartRows.length));
  $('order-chart-ticks').replaceChildren();$('order-chart-grid').replaceChildren();$('order-yield-chart').replaceChildren();$('order-breakdown-rows').replaceChildren();
  for(let tick=axisMax;tick>=0;tick-=10){
    const label=document.createElement('span');label.textContent=`${tick} %`;label.style.top=`${30+(axisMax-tick)/axisMax*238}px`;$('order-chart-ticks').append(label);
    const line=document.createElement('span');line.className='order-chart-gridline';$('order-chart-grid').append(line);
  }
  for(const row of chartRows){
    const bar=document.createElement('button');bar.type='button';bar.className='order-column';
    const mark=document.createElement('span');mark.className='order-column-mark';
    mark.style.setProperty('--bar-height',`${Math.max(0,Math.min(100,(row.yieldPercent??0)/axisMax*100))}%`);
    const fill=document.createElement('span');fill.className='order-column-bar';fill.hidden=row.yieldPercent==null;
    const value=document.createElement('span');value.className='order-column-value';
    value.textContent=row.yieldPercent==null?'Sin patrón':formatPercent(row.yieldPercent,true);
    if(row.yieldPercent==null)value.classList.add('empty');
    mark.append(fill,value);
    const diameter=document.createElement('span');diameter.className='order-column-diameter';diameter.textContent=String(row.diameterCm);
    bar.setAttribute('aria-label',`Diámetro ${row.diameterCm} centímetros, ${fmt(row.availableLogs)} trozos: ${value.textContent}. Ver esquema de corte.`);
    bar.addEventListener('click',()=>{showWorkspaceTab('patterns');selectDiameter(row.diameterCm);});
    bar.append(mark,diameter);$('order-yield-chart').append(bar);
  }
  for(const row of chartRows){
    const tr=document.createElement('tr');tr.dataset.used=String(row.usedLogs>0);
    const cells=[`${row.diameterCm} cm`,fmt(row.availableLogs),fmt(row.usedLogs),fmt(row.piecesA),fmt(row.piecesB),fmt(row.piecesC),fmt(row.recoveryPieces),`${fmt(row.volumeM3,2)} m³`,row.yieldPercent==null?'—':formatPercent(row.yieldPercent)];
    cells.forEach((content,index)=>{const cell=document.createElement('td');cell.textContent=content;if(index===4)cell.className='order-b-cell';if(index===0&&row.status==='no_pattern'){const badge=document.createElement('span');badge.className='order-no-pattern';badge.textContent='Sin patrón de corte';cell.append(badge);}tr.append(cell);});
    $('order-breakdown-rows').append(tr);
  }
  $('order-breakdown-count').textContent=`${chartRows.length} ${chartRows.length===1?'diámetro':'diámetros'}`;
  $('order-results').hidden=false;
}

function renderTabs() {
  $('diameter-tabs').replaceChildren();
  for(const d of DIAMETERS){
    const b=document.createElement('button');b.type='button';b.className='diameter-button';b.dataset.diameter=d;b.setAttribute('aria-pressed',String(d===state.selected));b.setAttribute('aria-label',`Diámetro ${d} centímetros`);b.innerHTML=`${d}<small>cm</small>`;
    b.addEventListener('click',()=>selectDiameter(d));$('diameter-tabs').append(b);
  }
}
function selectDiameter(d) {
  if(!DIAMETERS.includes(d))throw new Error('Selecciona uno de los diámetros del catálogo.');
  state.selected=d;state.selectedPiece=null;
  for(const el of $('diameter-tabs').children)el.setAttribute('aria-pressed',String(Number(el.dataset.diameter)===d));
  renderTable();renderPattern();
}
function renderTable() {
  renderExecutiveSummary();
  const c=state.snapshot;
  if(c){$('table-target-a').textContent='Piezas principales';$('table-target-b').textContent='Primer aprovechamiento';}
  $('results-rows').replaceChildren();
  for(const d of DIAMETERS){
    const r=selectedResult(d),tr=document.createElement('tr');
    tr.className=r?'result-row'+(d===state.selected?' selected':''):'pending-row';
    const cells=r?[`${d} cm`,fmt(r.cutting.nPrin),fmt(r.cutting.nApr),fmt(r.cutting.nApr2),fmt(r.recoveryCount),`${fmt(r.volume,4)} m³`,r.status==='no_pattern'?'Sin patrón':formatPercent(r.yield)]:[`${d} cm`,'—','—','—','—','—','—'];
    cells.forEach((text,i)=>{const td=document.createElement('td');td.textContent=text;td.className=['diameter-cell','cell-a','cell-b','','','','yield-cell'][i];if(i===6&&r?.status==='found')td.innerHTML=`<span class="table-yield"><span>${escapeHTML(text)}</span><i aria-hidden="true" style="width:${Math.max(0,Math.min(100,r.yield))}%"></i></span>`;tr.append(td);});
    const action=document.createElement('td');const button=document.createElement('button');button.type='button';button.className='row-link';button.textContent='↗';button.setAttribute('aria-label',`Ver esquema de diámetro ${d} cm`);button.disabled=!r;button.addEventListener('click',event=>{event.stopPropagation();selectDiameter(d);});action.append(button);tr.append(action);
    if(r)tr.addEventListener('click',()=>selectDiameter(d));$('results-rows').append(tr);
  }
  $('computed-label').textContent=`${state.results.size} / ${DIAMETERS.length} calculados`;
}

function renderExecutiveSummary(){
  const results=DIAMETERS.map(d=>selectedResult(d)).filter(Boolean);
  const best=results.reduce((a,b)=>!a||b.yield>a.yield?b:a,null);
  $('catalogue-average').textContent=results.length?formatPercent(results.reduce((sum,r)=>sum+r.yield,0)/results.length):'—';
  $('catalogue-best').textContent=best?`Ø ${fmt(best.diameterCm)} cm`:'—';
  $('catalogue-best-detail').textContent=best?`${formatPercent(best.yield)} de rendimiento JAS`:'Esperando el cálculo';
  $('catalogue-pieces').textContent=selectedResult()?fmt(selectedResult().cutting.nPrin):'—';
  $('catalogue-selected').textContent=`En el diámetro seleccionado · Ø ${state.selected} cm`;
  $('catalogue-progress').textContent=`${results.length} / ${DIAMETERS.length} calculados`;
  // Keep buttons stable while the worker reports results so keyboard focus survives.
  if(!$('catalogue-chart').children.length){
    for(const d of DIAMETERS){
      const button=document.createElement('button');button.type='button';button.className='catalogue-column';button.dataset.diameter=d;
      button.addEventListener('click',()=>selectDiameter(d));$('catalogue-chart').append(button);
    }
  }
  for(const button of $('catalogue-chart').children){
    const d=Number(button.dataset.diameter),r=selectedResult(d);
    button.setAttribute('aria-pressed',String(d===state.selected));
    button.setAttribute('aria-label',`Diámetro ${d} centímetros, ${r?formatPercent(r.yield)+' de rendimiento JAS':'pendiente de cálculo'}`);
    button.style.setProperty('--yield',`${Math.max(0,Math.min(100,r?.yield??0))}%`);
    button.innerHTML=`<span class="catalogue-column-track"><span class="catalogue-column-value">${r?formatPercent(r.yield,true):'—'}</span><i></i></span><strong>${d}</strong>`;
  }
  for(const button of $('diameter-tabs').children){
    const r=selectedResult(Number(button.dataset.diameter));
    button.innerHTML=`${button.dataset.diameter}<small>cm</small><span class="chip-yield">${r?formatPercent(r.yield,true):'—'}</span>`;
  }
}

function renderAlternatives() {
  const result=state.results.get(state.selected),alternatives=resultAlternatives(result),panel=$('alternatives-panel'),grid=$('alternative-grid');
  grid.replaceChildren();panel.hidden=!alternatives.length;
  $('alternative-count').textContent=`${alternatives.length} / 2`;
  if(!alternatives.length)return;
  const activeIndex=selectedAlternativeIndex(),bestIndex=Math.max(0,(bestYieldAlternative(result)?.alternative??1)-1);
  alternatives.forEach((alternative,index)=>{
    const button=document.createElement('button');button.type='button';button.className='alternative-card';button.dataset.alternative=String(index);
    button.setAttribute('aria-pressed',String(index===activeIndex));
    button.setAttribute('aria-label',`Alternativa ${index+1}: rendimiento ${fmt(alternative.yield,1)} por ciento, ${alternative.totalCount} piezas`);
    const title=document.createElement('strong');title.textContent=`Alternativa ${index+1}${index===bestIndex?' · Principal, luego JAS':''}`;
    const production=document.createElement('span');production.className='alternative-production';
    for(const [label,count] of [['Principal',alternative.cutting.nPrin],['Primer aprovechamiento',alternative.cutting.nApr],['Segundo aprovechamiento',alternative.cutting.nApr2],['Otras piezas',alternative.recoveryCount]]){
      const item=document.createElement('span'),name=document.createElement('span'),value=document.createElement('b');
      name.textContent=label;value.textContent=fmt(count);item.append(name,value);production.append(item);
    }
    const yieldValue=document.createElement('b');yieldValue.className='alternative-yield';yieldValue.textContent=formatPercent(alternative.yield);
    const cutting=alternative.cutting;
    const detail=document.createElement('small');
    detail.textContent=`${fmt(alternative.volume,4)} m³ · ${cutting.big?`Basa de ${fmt(cutting.X,1)} mm de ancho`:'Cara plana preparada por el carro'}`;
    detail.title=cutting.big?`${cutting.nIn} de ${cutting.A.seq.length} piezas del armado dentro de la basa; recorte técnico j = ${cutting.drop}`:`Cara plana a ${fmt(cutting.F,2)} mm de la médula (F)`;
    const yieldLabel=document.createElement('span');yieldLabel.textContent='Rendimiento JAS';yieldValue.append(yieldLabel);
    button.append(title,yieldValue,production,detail);
    button.addEventListener('click',()=>{
      state.alternativeSelections.set(state.selected,index);state.selectedPiece=null;state.historyKey=null;
      renderTable();renderPattern();
    });
    grid.append(button);
  });
}

function renderPattern() {
  const r=selectedResult(),c=state.snapshot;
  const legend=document.querySelector('.diagram-legend');
  legend.innerHTML='';
  renderAlternatives();
  $('print-sheet').disabled=!r||r.status!=='found';$('export-csv').disabled=state.running||state.results.size!==DIAMETERS.length;
  $('pattern-title').textContent=`Diámetro ${state.selected} cm`;
  if(!r||!c){
    $('large-result').hidden=true;
    $('selected-kpis').hidden=true;$('stage-explanation').textContent='Selecciona una etapa después del cálculo para recorrer el proceso.';
    $('pattern-subtitle').textContent=state.running?'Buscando piezas principales sanas y rendimiento JAS…':'Optimiza para ver el esquema.';
    $('pattern-state').textContent=state.running?'Calculando':'Pendiente';
    $('cut-diagram').innerHTML='<div class="diagram-placeholder">El esquema aparecerá al completar el cálculo.</div>';
    for(const id of ['yield-value','volume-value','geometric-value'])$(id).textContent='—';
    $('piece-list').replaceChildren();$('historical-inputs').replaceChildren();state.historyKey=null;return;
  }
  $('yield-value').textContent=formatPercent(r.yield);
  $('volume-value').textContent=`${fmt(r.volume,4)} m³`;
  $('geometric-value').textContent=formatPercent(r.geometricYield);
  $('length-label').textContent=`Largo ${fmt(c.length)} mm`;
  $('large-result').hidden=false;
  $('selected-kpis').hidden=false;
  renderLargeResult(r);
  $('piece-list').replaceChildren();
  for(const p of r.products){
    if(!p.active)continue;
    const n=r.counts[p.id]?.quantity??0;
    if(p.id>1&&!n)continue;
    const row=document.createElement('div');row.className='piece-total';
    const name=document.createElement('span');name.className='piece-total-label';const swatch=document.createElement('i');swatch.className='swatch '+(p.id===0?'a':p.id===1?'b':'recovery');
    swatch.style.background=CLASS_COLORS[p.cls];name.append(swatch,document.createTextNode(`${p.label} · ${dimensions(p)}`));
    const count=document.createElement('strong');count.textContent=`${n} `;const unit=document.createElement('small');unit.textContent='pzas';count.append(unit);row.append(name,count);$('piece-list').append(row);
  }
  $('diagram-detail').textContent='Selecciona una pieza para ver sus dimensiones y su ruta.';
  $('pattern-subtitle').textContent=`Método de corte general · ${cuttingScheme(r)} · ${fmt(c.length)} mm de largo`;
  $('pattern-state').textContent=r.status==='found'?'Calculado':'Sin producción';
  renderDiagram();
  renderHistoricalInputs();
}

function renderLargeResult(r){
  const l=r.cutting,kpis=[['Tablas a canteadora',`${fmt(l.nCant)} (${fmt(l.boards.length)} de lampazo · ${fmt(l.nCant-l.boards.length)} de la múltiple)`],['Piezas descartadas',`${fmt(l.nLost)} (${l.nLost22?`de ellas ${fmt(l.nLost22)} ${l.nLost22===1?'tabla':'tablas'} de 22 mm`:'ninguna tabla de 22 mm'})`],['Volumen producido / referencia JAS',`${fmt(l.vProd,4)} / ${fmt(l.vJAS,4)} m³`]];
  $('principal-value').textContent=fmt(l.nPrin);$('recovery-value').textContent=fmt(l.nApr+l.nApr2);$('classification-value').textContent=fmt(l.nClas);
  $('large-result').innerHTML=`<div class="large-indicators">${kpis.map(([label,value])=>`<div><span>${escapeHTML(label)}</span><strong>${escapeHTML(value)}</strong></div>`).join('')}</div><details class="technical-results"><summary>Ver producción, destinos y avisos técnicos</summary><div class="table-scroll"><table class="large-pieces"><thead><tr><th>Pieza</th><th>Sección mm</th><th>Cantidad</th><th>m³</th><th>Destino</th></tr></thead><tbody>${r.products.filter(p=>r.counts[p.id]?.quantity).map(p=>`<tr><td><i class="swatch" style="background:${CLASS_COLORS[p.cls]}"></i> ${escapeHTML(p.label)}</td><td>${escapeHTML(dimensions(p))}</td><td>${fmt(r.counts[p.id].quantity)}</td><td>${fmt(p.area*r.counts[p.id].quantity*state.snapshot.length/1e9,4)}</td><td>${p.cls==='med'?'Tabla central':['prin','apr','apr2'].includes(p.cls)?'Producto':'Mesa de clasificación'}</td></tr>`).join('')}</tbody></table></div><ul class="large-warnings">${l.warn.map(([level,message])=>`<li class="${escapeHTML(level)}">${escapeHTML(message)}</li>`).join('')}</ul></details>`;
}

function renderDiagram(){
  const r=selectedResult(),c=state.snapshot;
  if(!r||!c)return;
  const step=state.stage===0?5:state.stage;
  document.querySelectorAll('[data-stage]').forEach(button=>{
    const number=Number(button.dataset.stage)===0?5:Number(button.dataset.stage),active=number===step;
    button.setAttribute('aria-pressed',String(active));
    button.setAttribute('aria-current',active?'step':'false');
    button.dataset.progress=active?'current':number<step?'previous':'next';
  });
  document.querySelector('.diagram-legend').innerHTML=stageLegendHTML(r,state.stage);
  const legend=$('machine-cut-legend');
  legend.hidden=false;
  legend.innerHTML=`${state.stage===0?'':'<span><i class="current-cut-swatch"></i>Corte de esta máquina</span>'}<span><i class="previous-cut-swatch"></i>${state.stage===0?'Cortes realizados':'Cortes anteriores'}</span><span class="cut-hint">Los números remiten a las medidas de abajo. Pasa el cursor o usa Tab para consultar una pieza o un corte.</span>`;
  $('cut-diagram').innerHTML=stageSVG(r,c,state.stage,'screen');
  $('stage-outputs').innerHTML=stageOutputsHTML(r,state.stage,c);
  $('stage-piece-key').innerHTML=stagePieceListHTML(r,state.stage);
  $('stage-explanation').textContent=stageSummary(r,state.stage);
  $('diagram-detail').textContent='Sección de frente del trozo. Las piezas conservan su ubicación original para seguir el proceso; la lista identifica cada número y sus medidas.';
}
function inspectPiece(index) {
  const r=selectedResult(),p=r?.pieces[index];if(!p)return;
  const keyboardFocus=document.activeElement?.hasAttribute('data-piece');
  state.selectedPiece=index;renderDiagram();const sku=(r.products??state.snapshot.products)[p.productId];
  $('diagram-detail').textContent=`${sku.label} · ${dimensions(sku)} × ${fmt(state.snapshot.length)} mm · ${p.stage}`;
  if(keyboardFocus)$('cut-diagram').querySelector(`[data-piece="${index}"]`)?.focus();
}

function runOptimization(provided) {
  let config;
  try{config=provided||readConfig();config=normalizeConfig(config);}catch(error){showError(error.message);return Promise.reject(error);}
  if(typeof Worker==='undefined'){const error=new Error('Este navegador no permite el cálculo en segundo plano. Abre la aplicación en un navegador actualizado.');showError(error.message);return Promise.reject(error);}
  if(state.worker)state.worker.terminate();
  if(state.completion)state.completion.reject(new Error('El cálculo fue reemplazado por una nueva configuración.'));
  state.runId++;const runId=state.runId;state.results=new Map();state.alternativeSelections=new Map();state.historyKey=null;state.snapshot=config;state.selected=42;state.running=true;state.dirty=false;state.selectedPiece=null;
  try{localStorage.setItem(STORAGE_KEY,JSON.stringify(savedConfig(config)));}catch{}
  $('form-error').hidden=true;$('stale-banner').hidden=true;$('progress-track').hidden=false;$('progress-fill').style.width='0%';$('optimize-button').disabled=true;$('optimize-button').textContent='Calculando todos los diámetros…';$('run-caption').textContent='Buscando piezas principales sanas y rendimiento JAS.';$('table-description').textContent='Principal y aprovechamientos del mismo armado en todos los diámetros.';
  invalidateOrderPlan();syncOrderMeta();
  renderTabs();renderTable();renderPattern();
  const promise=new Promise((resolve,reject)=>{state.completion={resolve,reject};});
  const fail=message=>{
    state.running=false;$('optimize-button').disabled=false;$('optimize-button').innerHTML='Optimizar todos los diámetros <span aria-hidden="true">↗</span>';$('progress-track').hidden=true;$('run-caption').textContent='El cálculo no se completó.';$('table-description').textContent='Cálculo incompleto. Revisa el mensaje y vuelve a optimizar.';showError(message);
    refreshOrderStatus();
    state.worker?.terminate();state.worker=null;const completion=state.completion;state.completion=null;completion?.reject(new Error(message));
  };
  try{
    const worker=new Worker(new URL('./worker.js',import.meta.url),{type:'module'});state.worker=worker;
    worker.onmessage=event=>{
      const message=event.data;if(message.runId!==state.runId)return;
      if(message.type==='ready'){state.snapshot=message.config;syncOrderMeta();return;}
      if(message.type==='result'){
        state.results.set(message.result.diameterCm,message.result);
        $('progress-fill').style.width=`${message.completed/DIAMETERS.length*100}%`;
        $('run-caption').textContent=`${message.completed} de ${DIAMETERS.length} diámetros calculados.`;
        renderTable();if(state.selected===message.result.diameterCm)renderPattern();
      }
      if(message.type==='done'){
        state.running=false;state.worker?.terminate();state.worker=null;$('optimize-button').disabled=false;$('optimize-button').innerHTML='Optimizar todos los diámetros <span aria-hidden="true">↗</span>';$('progress-track').hidden=true;
        $('run-caption').textContent=state.dirty?'Hay cambios pendientes de optimizar.':'Todos los diámetros están calculados.';
        renderPattern();refreshOrderStatus();const completion=state.completion;state.completion=null;completion?.resolve(resultsSummary());
      }
      if(message.type==='error')fail(message.message);
    };
    worker.onerror=()=>fail('No se pudo iniciar el motor de cálculo. Recarga la página y vuelve a intentar.');
    worker.postMessage({runId,config});
  }catch(error){fail(error.message);}
  return promise;
}
function resultsSummary() {
  return {inputChangesPending:state.dirty,selectedDiameterCm:state.selected,results:DIAMETERS.filter(d=>state.results.has(d)).map(d=>{const r=selectedResult(d);return {diameterCm:d,status:r.status,quantities:r.counts,volumeM3:r.volume,yieldPercent:r.yield,geometricYieldPercent:r.geometricYield,basesMm:r.bases.map(b=>b.width)};})};
}
function renderHistoricalInputs(){
  const key=`${state.runId}:${state.selected}:${selectedAlternativeIndex()}`;
  if(key===state.historyKey){$('history-result').textContent='Pulsa Comparar cantidades para actualizar la comparación con este esquema.';return;}
  state.historyKey=key;$('historical-inputs').replaceChildren();$('historical-confirm').checked=false;$('history-result').textContent='';
  for(const p of activeProducts(state.snapshot,selectedResult())){
    const label=document.createElement('label');label.textContent=`${p.label} · ${dimensions(p)} mm`;
    const input=document.createElement('input');Object.assign(input,{type:'number',min:'0',step:'1',value:'0'});input.dataset.historyProduct=p.id;label.append(input);$('historical-inputs').append(label);
  }
}
function downloadFile(name,content,type){
  const url=URL.createObjectURL(new Blob([content],{type})),a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function renderRecommendation(){
  const plan=state.recommendation;
  const width=commonAssemblyWidth([plan.current,...plan.candidates]);
  $('recommend-result').innerHTML=plan.candidates.map((candidate,index)=>{
    const label=index?`Alternativa ${index+1}`:'Recomendado';
    const drawing=assemblyRows([{label:'Actual',candidate:plan.current},{label,candidate}],width);
    const comparison=planTable(plan.current,candidate,label);
    const headline=planHeadline(plan.current,candidate,plan.objective,index?'esta alternativa':'este armado');
    if(!index){
      const same=sameCuttingConfig(plan.current,candidate);
      const action=same?'':'<button type="button" class="primary-button" data-use-armado="0">Usar este armado</button><p class="field-help">Cambia el armado del panel izquierdo y recalcula todos los diámetros.</p>';
      return `<div class="recommended-armado">${same?'<p class="order-positive">Tu armado actual ya es el mejor para este pedido.</p>':headline}${drawing}${comparison}${action}</div>`;
    }
    return `${index===1?'<h4 class="plan-alternatives-heading">Otras opciones</h4>':''}<details><summary>${escapeHTML(alternativeSummary(candidate,plan.current,index,plan.objective))}</summary>${headline}${drawing}${comparison}<button type="button" class="secondary-button" data-use-armado="${index}">Usar esta alternativa</button></details>`;
  }).join('');
  for(const button of $('recommend-result').querySelectorAll('[data-use-armado]'))button.addEventListener('click',async()=>{
    const candidate=state.recommendation?.candidates[Number(button.dataset.useArmado)];
    if(!candidate)return;
    const config=candidateToSidebar(candidate);
    populateConfig(config);
    try{
      await runOptimization(config);
      if(!state.dirty){state.orderPlan=simulateOrder(state.results,state.orderStock,state.snapshot);renderOrderPlan();refreshOrderStatus();$('recommend-progress').textContent='Armado aplicado. El panel izquierdo y la producción del paso 2 ya están actualizados.';}
    }catch(error){$('recommend-progress').textContent=error.message;}
  });
}
function recommendArmado(){
  invalidateRecommendation();
  try{
    const config=readConfig(),lot=normalizeLot(state.orderStock);
    if(!Object.values(lot).some(q=>q>0))throw new Error('Ingresa al menos un trozo para recomendar un armado.');
    const worker=new Worker(new URL('./worker.js',import.meta.url),{type:'module'}),runId=state.planId;
    state.planWorker=worker;$('recommend-armado').disabled=true;
    $('recommend-progress').textContent='Buscando un armado para este pedido…';
    const fail=message=>{if(runId!==state.planId)return;worker.terminate();state.planWorker=null;$('recommend-armado').disabled=false;$('recommend-progress').textContent=message;};
    worker.onerror=()=>fail('No se pudo calcular el armado. Vuelve a intentarlo.');
    worker.onmessage=event=>{
      const message=event.data;if(runId!==state.planId||message.runId!==runId)return;
      if(message.type==='plan-progress')$('recommend-progress').textContent=`Armados evaluados ${message.completed} de ${message.total}`;
      if(message.type==='error')fail(message.message);
      if(message.type==='plan-done'){
        state.recommendation=message.plan;worker.terminate();state.planWorker=null;
        $('recommend-armado').disabled=false;$('recommend-progress').textContent='';renderRecommendation();
      }
    };
    worker.postMessage({type:'plan-run',runId,config,lot,objective:$('recommend-objective').value});
  }catch(error){$('recommend-progress').textContent=error.message;}
}
function machineData(){
  const config=readConfig(),lot=normalizeLot(state.orderStock);
  const occupied=DIAMETERS.filter(d=>lot[d]>0);
  const results=(occupied.length?occupied:DIAMETERS).map(diameterCm=>({diameterCm,cutting:compute({...config.cutting,d:diameterCm,length:config.length})}));
  return buildMachineInstructions({config,lot,results,date:new Date().toLocaleDateString('es-CL',{timeZone:'America/Santiago'})});
}
for(const host of document.querySelectorAll('[data-machine-controls]')){
  const buttons=document.createElement('div');buttons.className='button-row machine-print-buttons';
  buttons.setAttribute('role','group');buttons.setAttribute('aria-label','Imprimir fichas');
  const label=document.createElement('p');label.className='machine-actions-label';label.textContent='Imprimir fichas';
  const downloads=document.createElement('div');downloads.className='machine-download';
  const note=document.createElement('p');note.className='field-help';note.setAttribute('role','status');
  for(const [key,label] of [['all','Fichas de máquina'],...MACHINES.map(([key])=>[key,({carriage:'Carro huincha',bands:'Huinchas',multiple:'Múltiple',edger:'Canteadora'})[key]]),['csv','Cotas (CSV)']]){
    const button=document.createElement('button');button.type='button';button.className='secondary-button';button.textContent=label;
    if(key==='csv')button.className='tertiary-button';
    button.addEventListener('click',()=>{
      try{
        const data=machineData();
        if(key==='csv')downloadFile('cotas-por-maquina.csv',machineCSV(data),'text/csv;charset=utf-8');
        else{$('print-area').innerHTML=machineSheets(data,key==='all'?null:key);window.print();}
        note.textContent=`Armado actual del panel izquierdo · ${data.totalLogs} trozos · ${data.rows.length} diámetros.`;
      }catch(error){note.textContent=error.message;}
    });(key==='csv'?downloads:buttons).append(button);
  }host.append(label,buttons,downloads,note);
}
$('recommend-armado').addEventListener('click',recommendArmado);
$('recommend-objective').addEventListener('change',()=>{invalidateRecommendation();persistLot();});
window.addEventListener('pagehide',()=>state.planWorker?.terminate(),{once:true});
function showCurrentExportNotice(){
  $('export-notice').textContent=state.dirty?'Se exportaron los últimos resultados calculados. Hay cambios pendientes de optimizar.':'Se exportó la configuración calculada.';
}
function registerTools() {
  const context=document.modelContext;if(!context?.registerTool)return;
  const lifecycle=new AbortController();
  const cuttingSchema={type:'object',properties:Object.fromEntries(Object.keys(CUTTING_DEFAULTS).map(key=>[key,key==='med'?{type:'boolean'}:key==='cm'?{type:'string',enum:['60','75','y1','otro']}:{type:'number'}])),additionalProperties:false};
  const definitions=[{
    name:'optimize_cutting_patterns',title:'Optimizar esquemas de corte',description:'Configura el método general V2 y calcula todos los diámetros del catálogo. Medidas en milímetros.',
    inputSchema:{type:'object',properties:{cutting:cuttingSchema,length:{type:'integer',minimum:500,maximum:12000}},additionalProperties:false},
    annotations:{readOnlyHint:false,untrustedContentHint:false},async execute(input){const c=normalizeConfig({...readConfig(),...input});populateConfig(c);return runOptimization(c);}
  },{name:'get_cutting_results',title:'Consultar resultados de corte',description:'Resumen de los diámetros calculados.',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:true,untrustedContentHint:false},execute(){return resultsSummary();}},
  {name:'select_cutting_diameter',title:'Ver un diámetro',description:'Cambia el dibujo al diámetro indicado.',inputSchema:{type:'object',properties:{diameterCm:{type:'number',enum:DIAMETERS}},required:['diameterCm'],additionalProperties:false},annotations:{readOnlyHint:false,untrustedContentHint:false},execute(input){selectDiameter(input.diameterCm);return {selectedDiameterCm:state.selected};}}];
  for(const definition of definitions){try{Promise.resolve(context.registerTool(definition,{signal:lifecycle.signal})).catch(()=>{});}catch{}}
  window.addEventListener('pagehide',()=>lifecycle.abort(),{once:true});
}

$('config-form').addEventListener('submit',event=>{event.preventDefault();void runOptimization().catch(()=>{});});
$('config-form').addEventListener('input',markDirty);
for(const tab of document.querySelectorAll('.workspace-tabs [role="tab"]')){
  tab.addEventListener('click',()=>showWorkspaceTab(tab.id==='tab-order'?'order':'patterns'));
  tab.addEventListener('keydown',event=>{
    if(event.key!=='ArrowLeft'&&event.key!=='ArrowRight')return;
    event.preventDefault();const next=tab.id==='tab-order'?'patterns':'order';showWorkspaceTab(next);$(`tab-${next}`).focus();
  });
}
$('simulate-order').addEventListener('click',()=>{
  try{
    if(state.running||state.dirty||state.results.size!==DIAMETERS.length)throw new Error('Espera a que terminen de calcularse todos los diámetros.');
    const plan=simulateOrder(state.results,state.orderStock,state.snapshot);
    if(!plan.totals.availableLogs)throw new Error('Ingresa al menos un trozo en alguno de los diámetros.');
    state.orderPlan=plan;renderOrderPlan();refreshOrderStatus();
  }catch(error){state.orderPlan=null;$('order-results').hidden=true;$('order-notice').textContent=error.message;}
});
document.querySelectorAll('[data-stage]').forEach(button=>button.addEventListener('click',()=>{state.stage=Number(button.dataset.stage);state.selectedPiece=null;renderDiagram();}));
$('export-csv').addEventListener('click',()=>{if(state.running||state.results.size!==DIAMETERS.length)return;downloadFile('esquemas-mayor-rendimiento.csv',resultsCSV(DIAMETERS.map(d=>state.results.get(d)),state.snapshot),'text/csv;charset=utf-8');showCurrentExportNotice();});
$('print-sheet').addEventListener('click',()=>{const r=selectedResult();if(r?.status!=='found')return;const number=selectedAlternativeIndex()+1;$('print-area').innerHTML=printSheet(r,state.snapshot,{schemeLabel:`Alternativa ${number}`});$('export-notice').textContent=`En la ventana de impresión selecciona Guardar como PDF. La ficha usa la alternativa ${number} seleccionada.`;window.print();});
$('compare-history').addEventListener('click',()=>{
  try{const r=selectedResult();if(r?.status!=='found')throw new Error('Selecciona un esquema calculado antes de comparar.');if(!$('historical-confirm').checked)throw new Error('Confirma que tu esquema histórico está validado y usa las mismas condiciones.');const quantities=[...$('historical-inputs').querySelectorAll('input')].map(input=>input.value.trim()===''?NaN:Number(input.value));const comparison=historicalComparison(r,state.snapshot,quantities);$('history-result').textContent=`Histórico: ${fmt(comparison.volume,4)} m³ (${formatPercent(comparison.yieldPercent)}). Esquema actual: ${fmt(r.volume,4)} m³ (${formatPercent(r.yield)}). Diferencia: ${comparison.deltaVolume>=0?'+':''}${fmt(comparison.deltaVolume,4)} m³ y ${comparison.deltaPoints>=0?'+':''}${fmt(comparison.deltaPoints,2)} puntos porcentuales.${state.dirty?' Comparación con la última configuración calculada.':''}`;}catch(error){$('history-result').textContent=error.message;}
});
$('cut-diagram').addEventListener('click',event=>{const hit=event.target.closest('[data-piece]');if(hit)inspectPiece(Number(hit.dataset.piece));});
$('cut-diagram').addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){const hit=event.target.closest('[data-piece]');if(hit){event.preventDefault();inspectPiece(Number(hit.dataset.piece));}}});
if(typeof ResizeObserver!=='undefined'){const observer=new ResizeObserver(()=>{if(state.results.has(state.selected))renderDiagram();});observer.observe($('cut-diagram'));}
window.addEventListener('pagehide',()=>state.worker?.terminate(),{once:true});
for(const input of document.querySelectorAll('.large-configuration input,.large-configuration select'))input.addEventListener('input',()=>{
  if(input.id==='large-n'){
    const med=$('large-med').value==='yes';$('large-m').value=Number(input.value)-4-(med?Number($('large-c').value):0);
  }else if(input.id==='large-m'||input.id==='large-c'||input.id==='large-med')$('large-n').value=Number($('large-m').value)+4+($('large-med').value==='yes'?Number($('large-c').value):0);
  syncLargeControls();markDirty();
});
$('large-suggest').addEventListener('click',()=>{
  try{const p=readLargeConfig(),m=suggestM({...p,d:p.referenceDiameter});populateLargeConfig({...p,m});markDirty();}catch(error){$('large-suggestion').textContent=error.message;}
});
$('save-config').addEventListener('click',()=>{try{localStorage.setItem(STORAGE_KEY,JSON.stringify(savedConfig()));$('config-notice').textContent='Configuración guardada en este navegador.';}catch(error){showError(error.message);}});
$('export-config').addEventListener('click',()=>{try{downloadFile('configuracion-corte-v3.json',configurationFile(savedConfig()),'application/json');$('config-notice').textContent='Configuración exportada del método general.';}catch(error){showError(error.message);}});
$('import-config').addEventListener('click',()=>$('config-file').click());
$('config-file').addEventListener('change',async event=>{try{const file=event.target.files[0];if(!file)return;const text=await file.text(),parsed=JSON.parse(text),c=parsed?.format?parseConfiguration(text,normalizeConfig):parsed;populateConfig(c);$('config-notice').textContent='Configuración importada. Optimiza para actualizar resultados.';}catch(error){showError(`No se pudo importar: ${error.message}`);}finally{event.target.value='';}});
populateLargeConfig();
$('catalogue-count').textContent=DIAMETERS.length;
renderOrderStockInputs();refreshOrderStatus();renderTabs();renderTable();registerTools();
try{populateConfig(restoreConfiguration(localStorage));}catch(error){$('config-notice').textContent=`No se cargó la configuración guardada: ${error.message}`;}
void runOptimization().catch(()=>{});

// Ayuda al pasar el mouse sobre el dibujo del corte: muestra el data-tip del elemento bajo el cursor.
function setupDiagramTips(){
  try{
    const host=document.getElementById('cut-diagram');
    if(!host||typeof host.addEventListener!=='function'||typeof document.createElement!=='function'||!document.body)return;
    const tip=document.createElement('div');tip.className='cut-tip';tip.id='cut-diagram-tooltip';tip.setAttribute('role','tooltip');document.body.append(tip);
    let active=null;
    const hide=()=>{tip.classList.remove('show');if(active){active.classList.remove('tip-active');active.removeAttribute('aria-describedby');active=null;}};
    const show=event=>{
      const target=event.target?.closest?.('[data-tip]');
      if(!target||!host.contains(target)){hide();return;}
      if(active!==target){active?.classList.remove('tip-active');active?.removeAttribute('aria-describedby');active=target;active.classList.add('tip-active');active.setAttribute('aria-describedby',tip.id);tip.textContent=target.dataset.tip;}
      tip.classList.add('show');
      const pad=14,w=tip.offsetWidth,h=tip.offsetHeight;
      const bounds=target.getBoundingClientRect(),clientX=Number.isFinite(event.clientX)?event.clientX:bounds.left+bounds.width/2,clientY=Number.isFinite(event.clientY)?event.clientY:bounds.bottom;
      let x=clientX+pad,y=clientY+pad;
      if(x+w>window.innerWidth-8)x=clientX-w-pad;
      if(y+h>window.innerHeight-8)y=clientY-h-pad;
      tip.style.left=`${Math.max(8,x)}px`;tip.style.top=`${Math.max(8,y)}px`;
    };
    host.addEventListener('pointermove',show);
    host.addEventListener('pointerdown',show);
    host.addEventListener('pointerleave',hide);
    host.addEventListener('focusin',show);
    host.addEventListener('focusout',hide);
    host.addEventListener('keydown',event=>{if(event.key==='Escape')hide();});
    window.addEventListener('scroll',hide,{passive:true});
  }catch{}
}
setupDiagramTips();
