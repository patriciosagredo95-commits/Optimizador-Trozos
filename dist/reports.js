import {stageSVG,stageLegendHTML,stagePieceListHTML,stageOutputsHTML,stageSummary,DESTINATION_STYLES} from './stage-view.js';
export {stageSVG,productionLegend,stageLegendHTML,stagePieceListHTML,stageOutputsHTML,stageViewModel,stageLabelLayout,stageSummary,stagePieceGroups,compactNumbers,DESTINATION_STYLES} from './stage-view.js';
// Coordenadas del prototipo V2 en mm, con origen en la médula.
import {KC,KM,T,normalizeConfig} from './optimizer.js';
import {normalizeLot} from './run-planner.js';
export const CLASS_COLORS=Object.freeze({prin:'#7FA9CF',apr:'#9CC48A',apr2:'#B7A6D6',med:'#C99A6B',clas:'#E8C25A',cant:'#49A99A',cantInput:'#D9824E',block:'#EBDDC4',warn:'#E05A5A',lost:'#D9D6CF',none:'#D9D6CF',...Object.fromEntries(Object.entries(DESTINATION_STYLES).map(([key,style])=>[key,style.color]))});
const n=(value,d=3)=>Number(value).toLocaleString('es-CL',{maximumFractionDigits:d});
const esc=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const globalRect=(o,u0,u1,v0,v1)=>o==='xu'?{x0:u0,x1:u1,y0:v0,y1:v1}:{x0:v0,x1:v1,y0:u0,y1:u1};
const plantText=value=>String(value).replaceAll('Y1','Basa principal').replaceAll('Y2','Semibasa de primer aprovechamiento').replaceAll('Y3','Semibasa de segundo aprovechamiento');
const armPieceName=piece=>piece.t==='22'?'tabla':piece.t==='a'?'tabla central':'pieza principal';
export function cuttingScheme(result){
  const r=result.cutting;
  const bodies=['Y1','Y2','Y3'].map(role=>{const count=r.bodies.filter(body=>body.role===role&&!body.empty).length;return count?`${count} ${role==='Y1'?(count===1?'basa principal':'basas principales'):role==='Y2'?(count===1?'semibasa de primer aprovechamiento':'semibasas de primer aprovechamiento'):(count===1?'semibasa de segundo aprovechamiento':'semibasas de segundo aprovechamiento')}`:'';}).filter(Boolean).join(' · ');
  return r.big?`Basa de ${n(r.X)} mm · ${bodies}`:`Cara plana del carro · ${bodies}`;
}

function edgerGeometry(board,R){
  const {o,u0,u1,v0,v1}=board.g;
  const um=Math.max(Math.abs(u0),Math.abs(u1));
  const vl=Math.sqrt(Math.max(0,R*R-um*um));
  const lo=Math.max(v0,-vl),hi=Math.min(v1,vl);
  const width=board.plan.reduce((sum,piece)=>sum+piece.w,0)+Math.max(0,board.plan.length-1)*KM;
  let v=lo+(hi-lo-width)/2;
  const pieces=[],cuts=[];
  if(board.ok){
    cuts.push(globalRect(o,u0,u1,v-KM,v));
    for(const piece of board.plan){
      pieces.push({...globalRect(o,u0,u1,v,v+piece.w),cls:piece.k==='prin'?'prin':'cant'});
      v+=piece.w;
      cuts.push(globalRect(o,u0,u1,v,v+KM));
      v+=KM;
    }
  }
  return {pieces,cuts};
}

const geometryCut=(g,kerf,R,detail,number)=>{
  const axis=g.x1-g.x0<=kerf+1e-6?'vertical':'horizontal';
  const start=axis==='vertical'?g.x0:g.y0;
  return {number,start,position:start+kerf/2+R,kerf,axis,detail};
};

export function cutSequence(result){
  const r=result.cutting,R=r.R;
  const carriage=r.carroK.map((g,i)=>geometryCut(g,KC,R,(r.big?['cara lateral derecha','cara lateral izquierda','cara inferior de la basa']:['cara plana'])[i],i+1));
  const bands=[...r.huinK.map((g,i)=>geometryCut(g,KC,R,`límite de basa o semibasa ${i+1}`,i+1)),...r.boardK.map((g,i)=>geometryCut(g,KC,R,`tabla de lampazo ${i+1}`,r.huinK.length+i+1))];
  const groups=r.bodies.map((body,index)=>({
    base:plantText(body.name),width:2*body.ul,height:body.v1-body.v0,pieceCount:body.pieces.filter(piece=>piece.st!=='empty').length,
    sequence:body.arm.seq.map(piece=>`${armPieceName(piece)} ${n(piece.w)} mm`).join(' – '),
    limits:`Límites ${n(body.v0)} a ${n(body.v1)} mm desde la médula`,
    cuts:r.multK.filter(cut=>cut.bodyIndex===index).map((cut,i)=>geometryCut(globalRect(body.o,cut.u0,cut.u1,body.v0,body.v1),KM,R,`${plantText(body.name)}, entre piezas del armado`,i+1))
  }));
  let cutNumber=0;
  const edger=r.cant.flatMap(board=>edgerGeometry(board,R).cuts.map(g=>geometryCut(g,KM,R,`${plantText(board.origin)}; ancho útil ${n(board.W)}; plan ${board.plan.map(piece=>n(piece.w)).join(' – ')}`,++cutNumber)));
  return {
    carriage:{name:'Carro Huincha',cuts:carriage,outputs:r.big?[`Basa ${n(r.X)} mm; ${r.nIn} de ${r.A.seq.length} piezas del armado quedan dentro de la basa`,`Caras laterales a ${n(r.X/2)} mm a cada lado y cara inferior a ${n(r.yb)} mm desde la médula`]:[`Cara plana a ${n(r.F)} mm desde la médula`]},
    bands:{name:'Huinchas',cuts:bands,outputs:[...r.bodies.map(body=>`${plantText(body.name)}, ${n(body.v1-body.v0)} mm; límites ${n(body.v0)} a ${n(body.v1)} mm desde la médula → múltiple`),`${r.boards.length} tablas de lampazo de 22 mm → canteadora`]},
    multiple:{name:'Múltiple',groups,outputs:[`${r.nPrin} piezas principales; ${r.nApr} de primer y ${r.nApr2} de segundo aprovechamiento`,`${r.nClas} tablas de 22 a clasificación; ${r.nLost} piezas descartadas (${r.nLost22} de 22 mm)`]},
    edger:{name:'Canteadora',cuts:edger,outputs:r.cant.map(board=>`${plantText(board.origin)}; ${board.W>0?n(board.W)+' mm útiles':'sin ancho útil'} → ${board.ok?board.plan.map(piece=>n(piece.w)).join(' – ')+' mm':'descarte'}`)},
    reference:'Centros de sierra medidos desde el borde izquierdo (cortes verticales) o inferior (cortes horizontales) del diámetro. Los límites de basas y semibasas y las caras del carro también se indican desde la médula. El ancho de corte queda hacia afuera de las caras del carro.'
  };
}

export function printSheet(result,config,options={}){
  const r=result.cutting,sequence=cutSequence(result);
  const scheme=cuttingScheme(result);
  const table=(cuts,prefix)=>`<table class="print-cut-table"><thead><tr><th>Corte</th><th>Centro de sierra (mm)</th><th>Ancho de corte (mm)</th><th>Cara / referencia</th></tr></thead><tbody>${cuts.length?cuts.map(cut=>`<tr><td><strong>${prefix}${cut.number}</strong></td><td>${n(cut.position)}</td><td>${n(cut.kerf)}</td><td>${esc(cut.axis)} · ${esc(cut.detail)}</td></tr>`).join(''):'<tr><td colspan="4">Sin cortes.</td></tr>'}</tbody></table>`;
  const outputs=values=>`<p class="print-machine-output">${values.map(esc).join(' · ')}</p>`;
  const rows=r.prod.map(piece=>`<tr><td>${esc(piece.label)}</td><td>${esc(piece.sec)}</td><td>${piece.n}</td><td>${n(piece.area*config.length/1e9,4)}</td><td>${esc(piece.dest)}</td></tr>`).join('');
  const machineNames=['Carro Huincha','Huinchas','Múltiple','Canteadora'];
  const details=[table(sequence.carriage.cuts,'C'),table(sequence.bands.cuts,'H'),sequence.multiple.groups.map(group=>`<div class="print-cut-group"><h4>Múltiple · ${esc(group.base)}</h4><p>${esc(group.limits)} · armado ${esc(group.sequence)} · centrado en la médula</p><p>Inicio y fin de piezas desde la médula: ${r.A.seq.map((piece,i)=>`Nº ${i+1}, ${armPieceName(piece)}: ${n(piece.u0)} a ${n(piece.u1)}`).join(' · ')} mm</p>${table(group.cuts,'M')}</div>`).join(''),table(sequence.edger.cuts,'E')];
  const drawingKey=current=>`<p class="print-drawing-key">${current?'Corte de esta máquina: trazo continuo oscuro. ':''}${current?'Cortes anteriores':'Cortes realizados'}: trazo fino discontinuo. Desecho: trama cruzada. Números: medidas en la lista.</p>`;
  return `<section class="print-overview">
    <header class="print-header">
    <img src="./glover-logo.png" alt="Glover">
    <div>
    <p class="print-kicker">Planificación Aserradero</p>
    <h1>Ficha operativa de corte</h1>
    <p>${esc(options.schemeLabel??'Esquema V2 de mayor prioridad')} · ${new Date().toLocaleDateString('es-CL')}</p>
    </div>
    </header>
    <div class="print-meta">
    <strong>Trozo Ø ${result.diameterCm} cm</strong>
    <span>Largo ${n(config.length)} mm</span>
    <span>${esc(scheme)}</span>
    </div>
    <div class="print-main">
    <section class="print-final-view">
    <h2>5 · Resultado final</h2><p>${esc(stageSummary(result,0))}</p>${stageSVG(result,config,0,'print-final')}${drawingKey(false)}<div class="print-product-legend">${stageLegendHTML(result)}</div>${stagePieceListHTML(result)}
    </section>
    <section class="print-output">
    <h2>Producción por trozo</h2>
    <div class="print-stat-grid"><div><span>Rendimiento JAS</span><strong>${n(result.yield,2)} %</strong></div><div><span>Piezas principales</span><strong>${n(r.nPrin)}</strong></div><div><span>Piezas de aprovechamiento</span><strong>${n(r.nApr+r.nApr2)}</strong></div></div>
    <p>Principal ${r.nPrin} (${r.nY1} basas principales) · Aprov. 1 ${r.nApr} · Aprov. 2 ${r.nApr2} · 22 a clasificación ${r.nClas} ${r.nLost} descartadas (${r.nLost22} de 22 mm) · Canteadora ${r.nCant}</p>
    <p>V_prod ${n(result.volume,4)} m³ / V_JAS ${n(result.referenceVolume,4)} m³ · Rendimiento ${n(result.yield,2)} %</p>
    <table class="print-production">
    <thead>
    <tr>
    <th>Pieza</th>
    <th>Sección (mm)</th>
    <th>Cant.</th>
    <th>m³</th>
    <th>Destino</th>
    </tr>
    </thead>
    <tbody>${rows}</tbody>
    </table>
    </section>
    </div>
    <section class="print-process">
    <h2>Secuencia operativa</h2>
    <div class="print-stage-grid">${machineNames.map((name,i)=>`<figure>
    <figcaption>${i+1} · ${name}</figcaption>${stageSVG(result,config,i+1,'print-'+i)}${drawingKey(true)}<div class="print-product-legend">${stageLegendHTML(result,i+1)}</div>${stageOutputsHTML(result,i+1,config)}${stagePieceListHTML(result,i+1)}</figure>`).join('')}</div>
    <p>Carro y huinchas 3,4 mm · múltiple y canteadora 4,2 mm. Corte de esta máquina: trazo continuo oscuro. Cortes anteriores: trazo fino discontinuo. Desecho: trama cruzada.</p>
    </section>
    <section>
    <h3>Avisos</h3>${r.warn.map(warning=>`<p>${esc(warning[0])} · ${esc(warning[1])}</p>`).join('')}</section>
    </section>
    <section class="print-cut-details">
    <h2>Cotas de corte por máquina</h2>
    <p class="print-reference-note">${esc(sequence.reference)}</p>${Object.entries(sequence).filter(([key])=>key!=='reference').map(([key,machine],i)=>`<section class="print-machine">
    <h3>${machine.name}</h3>${details[i]}${outputs(machine.outputs)}</section>`).join('')}<h3>Cotas de las basas</h3>
    <p>${r.big?`Caras laterales del carro a ${n(r.X/2)} mm a cada lado de la médula y cara inferior a ${n(r.yb)} mm de la médula. Basa principal centrada en la médula.`:`Cara de carro a ${n(r.F)} mm desde la médula. Basas y semibasas conservan el mismo armado.`}</p>
    </section>`;
}

export function historicalComparison(r,c,quantities) {
  const ps=activeProducts(c,r);
  if(quantities.length!==ps.length||quantities.some(q=>!Number.isInteger(q)||q<0))throw new Error('Ingresa cantidades históricas enteras y no negativas.');
  const area=ps.reduce((sum,p,i)=>sum+p.area*quantities[i],0);
  if(area<=0)throw new Error('Ingresa al menos una pieza histórica.');
  if(area>Math.PI*r.radius*r.radius+.001)throw new Error('Las piezas históricas superan el área útil del trozo. Revisa las cantidades.');
  const volume=area*c.length/1e9,yieldPercent=volume/r.referenceVolume*100;
  return {volume,yieldPercent,deltaVolume:r.volume-volume,deltaPoints:r.yield-yieldPercent};
}


export const escapeHTML=esc;
export const activeProducts=(config,result)=>result.products.filter(product=>product.active);
export const CUT_MACHINES=[
  {key:'carriage',name:'Carro Huincha',color:'#C8322A'},
  {key:'bands',name:'Huinchas',color:'#C8322A'},
  {key:'multiple',name:'Múltiple',color:'#C8322A'},
  {key:'edger',name:'Canteadora',color:'#C8322A'}
];
export const STORAGE_KEY='glover-cutting-config-v3';
function withPlanning(config,normalize=normalizeConfig){
  const result=normalize(config);
  if(config?.lot!==undefined||config?.mode!==undefined){
    result.lot=normalizeLot(config.lot);
    if(config.mode!==undefined)result.mode=config.mode==='advanced'?'advanced':'simple';
    result.objective=config.objective==='volume'?'volume':'principal';
  }
  return result;
}
export function configurationFile(config){
  return JSON.stringify({format:'corte-config',version:3,configuration:withPlanning(config)},null,2);
}
export function parseConfiguration(text,normalize=normalizeConfig){
  const file=JSON.parse(text);
  if(file?.format!=='corte-config'||![1,3].includes(file.version))throw new Error('Selecciona una configuración guardada desde Corte.');
  return withPlanning(file.configuration,normalize);
}
export function restoreConfiguration(storage){
  const saved=storage.getItem(STORAGE_KEY);
  if(saved)return withPlanning(JSON.parse(saved));
  const previous=storage.getItem('glover-cutting-config-v2');
  return previous?normalizeConfig(JSON.parse(previous)):normalizeConfig();
}
export function resultsCSV(results,config){
  const headers=['Diámetro (cm)','Largo (mm)','Esquema','Principal','Aprov. 1','Aprov. 2','22 a clasificación','Descartadas','Descartadas de 22 mm','Tablas a canteadora','V_prod (m3)','V_JAS (m3)','Rendimiento (%)','Piezas y destino','Avisos','Cotas carro','Cotas huinchas','Armado y cotas múltiple','Plan y cotas canteadora'];
  const rows=results.map(result=>{
    const r=result.alternatives?.[0]??result,l=r.cutting,s=cutSequence(r);
    return [r.diameterCm,config.length,cuttingScheme(r),l.nPrin,l.nApr,l.nApr2,l.nClas,l.nLost,l.nLost22,l.nCant,r.volume,r.referenceVolume,r.yield,JSON.stringify(l.prod),l.warn.map(w=>w[1]).join(' | '),JSON.stringify(s.carriage),JSON.stringify(s.bands),JSON.stringify(s.multiple),JSON.stringify(s.edger)];
  });
  return '\ufeff'+[headers,...rows].map(row=>row.map(value=>'"'+String(typeof value==='number'?String(value).replace('.',','):value).replaceAll('"','""')+'"').join(';')).join('\r\n');
}
