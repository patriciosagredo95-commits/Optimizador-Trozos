import {armMain,cantCenter} from './optimizer.js';
import {formatPercent} from './format.js';

const fmt=(n,d=0)=>new Intl.NumberFormat('es-CL',{minimumFractionDigits:d,maximumFractionDigits:d}).format(n);
const escape=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const thickness=n=>fmt(n,n%1?1:0);
const types={X1:{className:'arm-principal',name:'Principal',plural:'piezas principales'},'22':{className:'arm-clasificacion',name:'Clasificación',plural:'tablas de clasificación'},a:{className:'arm-central',name:'Tabla central',plural:'tablas centrales'}};
const metrics=[['Piezas principales','piecesA',0,''],['Volumen aserrado','volumeM3',2,' m³'],['Rendimiento del lote','yieldPercent',1,' puntos']];
const sign=n=>n>0?'+':n<0?'−':'';

export function commonAssemblyWidth(candidates){
  return Math.max(...candidates.map(candidate=>armMain(candidate.config.cutting).X));
}

// Round before deciding the trend, so a displayed zero never claims a change.
export function comparisonRows(current,candidate){
  return metrics.map(([label,key,digits,unit])=>{
    const before=current.totals[key],after=candidate.totals[key];
    const delta=before==null||after==null?null:Number((after-before).toFixed(digits));
    const value=n=>n==null?'—':key==='yieldPercent'?formatPercent(n):`${fmt(n,digits)}${unit}`;
    const relative=delta!==null&&delta!==0&&before>0?` (${sign(delta)}${formatPercent(Math.abs(delta/before*100))})`:'';
    return {label,key,delta,relative,current:value(before),recommended:value(after),trend:delta==null||delta===0?'equal':delta>0?'better':'worse',difference:delta==null?'—':delta===0?'Sin cambio':`${sign(delta)}${fmt(Math.abs(delta),digits)}${unit}${key==='piecesA'?relative:''}`};
  });
}

export function planHeadline(current,candidate,objective,noun='este armado'){
  const rows=comparisonRows(current,candidate),volume=objective==='volume',main=rows[volume?1:0];
  const subject=escape(noun.charAt(0).toUpperCase()+noun.slice(1));
  let conclusion;
  if(main.delta===null)conclusion=`${subject}: no hay resultado del lote para comparar.`;
  else if(main.delta===0)conclusion=volume?`${subject} da el mismo volumen aserrado que tu armado actual.`:`${subject} da las mismas piezas principales que tu armado actual.`;
  else{
    const amount=volume?`${fmt(Math.abs(main.delta),2)} m³`:`${fmt(Math.abs(main.delta))} piezas principales`;
    conclusion=`Con ${escape(noun)} el lote da <strong>${amount} ${main.delta>0?'más':'menos'}</strong>${volume?' de volumen aserrado':''}${main.relative}.`;
  }
  const secondary=rows.filter(row=>row!==main).map(row=>`${row.key==='yieldPercent'?'Rendimiento':row.label} ${row.difference}`).join(' · ');
  return `<p class="plan-headline ${main.trend}">${conclusion}</p><p class="plan-secondary">${secondary}</p>`;
}

export function assemblyRows(entries,maxWidth){
  const rows=entries.map(({label,candidate})=>{
    const arm=armMain(candidate.config.cutting),groups=[];
    const pieces=arm.seq.map(piece=>{
      const last=groups.at(-1);
      if(last?.t===piece.t&&last.w===piece.w)last.count++;
      else groups.push({...piece,count:1});
      return `<span class="arm-piece ${types[piece.t].className}" style="left:${((piece.u0+arm.X/2)/arm.X*100).toFixed(2)}%;width:${(piece.w/arm.X*100).toFixed(2)}%" title="${types[piece.t].name} ${thickness(piece.w)} mm">${thickness(piece.w)}</span>`;
    }).join('');
    const description=groups.map(piece=>`${piece.count} ${types[piece.t].plural} de ${thickness(piece.w)} mm`).join(', ');
    return `<div class="arm-row"><span class="arm-row-label">${escape(label)}</span><div class="arm-track"><div class="arm-body" style="width:${(arm.X/maxWidth*100).toFixed(2)}%" role="img" aria-label="${escape(label+': '+description)}">${pieces}</div></div></div>`;
  }).join('');
  // Pantalla de operaciones: cada pieza ya muestra su espesor, sin leyenda ni notas.
  return `<div class="arm-compare">${rows}</div>`;
}

export function planTable(current,candidate,label='Recomendado'){
  const before=current.config.cutting,after=candidate.config.cutting;
  const marked=(value,previous)=>value===previous?escape(value):`<mark>${escape(value)}</mark>`;
  const principal=p=>`${fmt(p.m)} de ${thickness(p.x1)} mm`;
  const medulla=p=>p.med?`Encerrada con ${fmt(p.c)} tablas de ${thickness(p.a)} mm`:'Sin encerrar';
  const edger=p=>[p.e1,cantCenter(p).w,p.e2];
  const oldEdger=edger(before),newEdger=edger(after);
  // Solo lo que se ajusta en planta; el resultado del lote va en el titular.
  const plantRows=[['Piezas principales en la múltiple',principal(before),`${marked(fmt(after.m),fmt(before.m))} de ${marked(thickness(after.x1),thickness(before.x1))} mm`]];
  if(medulla(after)!==medulla(before))plantRows.push(['Médula',medulla(before),marked(medulla(after),medulla(before))]);
  plantRows.push(['Canteadora (extremo / centro / extremo)',oldEdger.map(thickness).join(' / ')+' mm',newEdger.map((n,i)=>marked(thickness(n),thickness(oldEdger[i]))).join(' / ')+' mm']);
  return `<div class="table-scroll"><table class="plan-table"><caption>Qué cambia en la planta</caption><thead><tr><th scope="col"></th><th scope="col">Actual</th><th scope="col">${escape(label)}</th></tr></thead><tbody>${plantRows.map(([name,oldValue,newValue])=>`<tr><th scope="row">${name}</th><td>${oldValue}</td><td>${newValue}</td></tr>`).join('')}</tbody></table></div>`;
}

export function alternativeSummary(candidate,current,index,objective='principal'){
  const p=candidate.config.cutting,row=comparisonRows(current,candidate)[objective==='volume'?1:0];
  const difference=row.delta===null?'Sin resultado para comparar':row.delta===0?'Sin cambio':`${sign(row.delta)}${fmt(Math.abs(row.delta),objective==='volume'?2:0)} ${objective==='volume'?'m³':'piezas principales'}`;
  return `Alternativa ${index+1} · ${fmt(p.m)} piezas principales de ${thickness(p.x1)} mm · ${difference}`;
}

export function sameCuttingConfig(a,b){
  const left=a.config.cutting,right=b.config.cutting;
  return [...new Set([...Object.keys(left),...Object.keys(right)])].every(key=>left[key]===right[key]);
}
