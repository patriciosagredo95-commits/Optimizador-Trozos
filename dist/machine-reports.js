import {escapeHTML as esc} from './reports.js';

const f=value=>Number(value).toLocaleString('es-CL',{maximumFractionDigits:1});
export const MACHINES=[['carriage','CARRO HUINCHA'],['bands','HUINCHAS 1 y 2'],['multiple','SIERRA MÚLTIPLE'],['edger','CANTEADORA']];
const table=(heads,rows)=>`<table><thead><tr>${heads.map(h=>`<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.map(row=>`<tr>${row.map(cell=>`<td>${cell}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
function sequence(bodies){
  const groups=[];
  for(const body of bodies){
    const last=groups.at(-1);
    if(last&&last.role===body.role&&Math.abs(last.width-body.width)<1e-6)last.count++;
    else groups.push({...body,count:1});
  }
  return groups.map(body=>`${body.count>1?body.count+'× ':''}${roleName(body.role)} ${f(body.width)}`).join(' → ')||'Sin cuerpos';
}
function strip(pieces,width){
  return `<svg class="machine-strip" viewBox="0 0 ${width} 48" role="img" aria-label="Armado proporcional de izquierda a derecha">${pieces.map((piece,i)=>`<rect x="${piece.start}" y="1" width="${piece.width}" height="45" fill="white" stroke="black" stroke-width=".8"/><text x="${piece.start+piece.width/2}" y="17" text-anchor="middle" font-size="11">${i+1}</text><text x="${piece.start+piece.width/2}" y="31" text-anchor="middle" font-size="8">${piece.label==='22'?'Tabla':piece.label==='a'?'Central':'Principal'}</text><text x="${piece.start+piece.width/2}" y="42" text-anchor="middle" font-size="9">${f(piece.width)}</text>`).join('')}</svg>`;
}
function armLabel(pieces){
  const groups=[];
  for(const piece of pieces){const last=groups.at(-1);if(last&&last.label===piece.label&&last.width===piece.width)last.count++;else groups.push({...piece,count:1});}
  return groups.map(group=>`${group.count} ${group.label==='22'?'tablas':group.label==='a'?'tablas centrales':'principales'} ${f(group.width)}`).join(' · ');
}
const diameter=row=>`${f(row.diameter/10)} cm${row.critical.length?' †':''}`;
const roleName=role=>({Y1:'Principal',Y2:'1er aprov.',Y3:'2º aprov.'})[role]??role;
const plantText=text=>text.replaceAll('Y1','Principal').replaceAll('Y2','1er aprov.').replaceAll('Y3','2º aprov.').replaceAll('X1','espesor principal');
const pieceName=piece=>`${piece.label==='22'?'Tabla':piece.label==='a'?'Tabla central':'Principal'} ${f(piece.width)}`;
const slab=(value,bottom=false)=>value<=0?(bottom?'Sin lampazo inferior':'Sin lampazo'):f(value);
const program=data=>[1,2,3].filter(i=>data.config.cutting['y'+i]>0).map(i=>`${['Principal','1er aprov.','2º aprov.'][i-1]} ${f(data.config.cutting['x'+i])}×${f(data.config.cutting['y'+i])}`).join(' · ');
const lampazos=row=>{const l=row.bands.lampazos;return row.carriage.big?`Laterales ${l['Lampazo lateral derecho']}+${l['Lampazo lateral izquierdo']} · Inferior ${l['Lampazo inferior']} · Superior ${l['Lampazo superior']} tablas`:`Lampazo carro: ${tablas(l['Lampazo del carro'])} · Lampazo huinchas: ${tablas(l['Lampazo de huinchas'])}`;};
const tablas=count=>`${count} ${Number(count)===1?'tabla':'tablas'}`;
function contents(data,key){
  if(key==='carriage'){
    const small=data.rows.filter(row=>!row.carriage.big),large=data.rows.filter(row=>row.carriage.big);
    return `<p>Kerf ${f(data.carriageKerf)} mm hacia el lampazo. Espesores desde la corteza. Distancia a médula como referencia.</p>${small.length?`<h2>Menores de 36 cm · un corte / un lampazo</h2>${table(['Diámetro','Lampazo desde corteza mm','Cara a médula mm'],small.map(row=>[diameter(row),slab(row.carriage.cuts[0].barkThickness),f(Math.abs(row.carriage.face))]))}`:''}${large.length?`<h2>Desde 36 cm · tres cortes</h2>${table(['Diámetro','Cada lateral desde corteza mm','Inferior desde corteza mm','Basa X mm','Inferior a médula mm'],large.map(row=>[diameter(row),slab(row.carriage.cuts[0].barkThickness),slab(row.carriage.cuts[2].barkThickness,true),f(row.carriage.baseWidth),f(Math.abs(row.carriage.lowerFace))]))}`:''}<p>Cómo leer esta ficha · Laterales centrados en la médula: cada cara a la mitad de X, una a cada lado. Ancho de basa = X. Lampazo = radio menos distancia absoluta de la cara a médula, incluye kerf.</p>`;
  }
  if(key==='bands')return `<p>Kerf 3,4 mm · Cuerpos a múltiple en orden de corte · Tablas de lampazo de 22 mm a canteadora.</p>${table(['Diámetro','Cuerpos · anchos mm','Tablas por lampazo / trozo'],data.rows.map(row=>[diameter(row),esc(sequence(row.bands.bodies)),lampazos(row)]))}<p>Cómo leer esta ficha · Anchos del programa. Mayor: principales desde abajo, luego aprovechamientos superiores e inferiores. Menor: avanzar desde cara lateral al lado opuesto.</p>`;
  if(key==='multiple'){
    const m=data.multiple;
    return `<div class="machine-key">X ${f(m.width)} mm · Kerf ${f(m.kerf)} mm · ${m.sawCount} sierras internas</div>${strip(m.pieces,m.width)}<p>Armado fijo durante toda la corrida. Banda proporcional, piezas nombradas y numeradas. Casillas en mm, primera línea número, tipo y ancho. Segunda línea fin de pieza / centro de sierra siguiente.</p><div class="machine-piece-grid">${m.pieces.map(piece=>`<div><b>${piece.number}. ${esc(pieceName(piece))}</b><br>${f(piece.end)} / ${piece.number<m.pieces.length?f(m.saws[piece.number-1].center):'—'}</div>`).join('')}</div><p>Cómo leer esta ficha · Partir del borde izquierdo del armado (0 mm). Fin es la cara final de cada pieza. Sierra es el centro del kerf siguiente. X = suma de piezas + (${m.pieces.length} − 1) × 4,2 mm. Las sierras internas cortan entre piezas. Ambas caras exteriores vienen del carro. Armado centrado en la médula.</p>`;
  }
  const e=data.edger;
  return `<div class="machine-key">${e.pieces.map((p,i)=>`${['Extremo izquierdo','Centro','Extremo derecho'][i]} ${f(p.width)}`).join(' · ')} mm</div><p>Armado completo ${f(e.width)} mm · Kerf 4,2 mm. Posiciones desde el borde izquierdo del ancho útil. Primer corte exterior en 0 (corte de borde). Centros interiores ${e.sawCenters.slice(1,-1).map(f).join(' / ')} mm. Último corte exterior en el borde derecho.</p><p>Si cabe: armado completo · dos extremos · pieza más ancha que quepa · descarte.</p>${table(['Diámetro','Entrada / trozo','Aprovechadas','Descartadas','Salida / trozo'],data.rows.map(row=>[diameter(row),row.edger.boards,row.edger.accepted,row.edger.discarded,row.edger.pieces]))}<p>Cómo leer esta ficha · Incluye tablas de lampazo y múltiple. Centrar el plan que cabe en el ancho útil de cada tabla. Los cortes exteriores limpian los bordes.</p>`;
}
export function machineSheets(data,machine=null){
  return MACHINES.filter(([key])=>!machine||key===machine).map(([key,name])=>`<section class="machine-page" data-machine="${key}"><header class="machine-header"><img src="./glover-logo.png" alt="Glover"><div><p>Planificación Aserradero · Fichas de máquina</p><h1>${name}</h1></div></header><div class="machine-run"><div>Programa ${program(data)} mm</div><div>Armado ${armLabel(data.multiple.pieces)} · médula ${data.config.cutting.med?'encerrada':'sin encerrar'}</div><div>Largo ${f(data.config.length)} mm · Fecha ${esc(data.date)} · Total ${f(data.totalLogs)} trozos${data.catalogue?' · Catálogo completo, lote vacío':''}</div></div>${data.rows.some(row=>row.critical.length)?'<p class="machine-alert">† Diámetro con aviso crítico del motor. Revisar su esquema antes de operar.</p>':''}${contents(data,key)}</section>`).join('');
}

export function machineCSV(data){
  const rows=[['Máquina','Diámetro (cm)','Trozos','Dato','Valor / secuencia','Unidad','Referencia']];
  const add=(machine,row,label,value,unit='',reference='')=>rows.push([machine,row?`${f(row.diameter/10)} cm`:'',row?f(row.qty):'',label,value,unit,reference]);
  add('Corrida',null,'Programa',program(data),'mm');
  add('Corrida',null,'Fecha',data.date);add('Corrida',null,'Largo',f(data.config.length),'mm');
  add('Corrida',null,'Total trozos',data.totalLogs);add('Corrida',null,'Catálogo completo',data.catalogue?'Sí':'No');
  for(const row of data.rows){
    add('Carro huincha',row,'Cantidad de cortes',row.carriage.cutCount);
    add('Carro huincha',row,'Basa X',row.carriage.baseWidth===null?'':f(row.carriage.baseWidth),'mm');
    row.carriage.cuts.forEach((cut,i)=>{
      add('Carro huincha',row,`Cara ${i+1}`,f(Math.abs(cut.face)),'mm',`Distancia a médula, lado ${row.carriage.big?['derecho','izquierdo','inferior'][i]:'del corte lateral'}`);
      add('Carro huincha',row,`Centro sierra ${i+1}`,f(Math.abs(cut.sawCenter)),'mm',`Distancia a médula, lado ${row.carriage.big?['derecho','izquierdo','inferior'][i]:'del corte lateral'}`);
      add('Carro huincha',row,`Lampazo ${i+1}`,slab(cut.barkThickness,row.carriage.big&&i===2),'mm','R − |cara|, incluye kerf');
    });
    add('Carro huincha',row,'Kerf','3,4','mm');
    row.bands.bodies.forEach((body,i)=>add('Huinchas 1 y 2',row,`Cuerpo ${i+1} ${roleName(body.role)}`,f(body.width),'mm',`Orden de corte ${i+1}`));
    for(const [origin,count] of Object.entries(row.bands.lampazos))add('Huinchas 1 y 2',row,origin,count,'tablas de 22 mm');
    add('Huinchas 1 y 2',row,'Kerf','3,4','mm');
    for(const key of ['boards','accepted','discarded','pieces'])add('Canteadora',row,({boards:'Tablas de entrada',accepted:'Tablas aprovechadas',discarded:'Tablas descartadas',pieces:'Piezas de salida'})[key],row.edger[key],'por trozo');
    row.edger.plans.forEach(plan=>add('Canteadora',row,plantText(plan.origin),plan.widths.map(f).join(' | ')||'Descarte','mm',`Ancho útil ${f(plan.usableWidth)} mm`));
    row.critical.forEach(message=>add('Avisos',row,'Crítico',plantText(message)));
  }
  for(const piece of data.multiple.pieces)add('Sierra múltiple',null,`Pieza ${piece.number} ${pieceName(piece)}`,f(piece.width),'mm',`Inicio ${f(piece.start)}, fin ${f(piece.end)} desde borde izquierdo`);
  for(const saw of data.multiple.saws)add('Sierra múltiple',null,`Centro sierra ${saw.number}`,f(saw.center),'mm','Desde borde izquierdo del armado');
  add('Sierra múltiple',null,'X',f(data.multiple.width),'mm','Σ anchos + (N − 1) × 4,2');
  add('Sierra múltiple',null,'Sierras',data.multiple.sawCount);add('Sierra múltiple',null,'Kerf','4,2','mm');
  data.edger.pieces.forEach((piece,i)=>add('Canteadora',null,['Extremo izquierdo','Centro','Extremo derecho'][i],f(piece.width),'mm'));
  add('Canteadora',null,'Centros de sierras',['0 (corte de borde)',...data.edger.sawCenters.slice(1,-1).map(f),'Borde derecho'].join(' | '),'mm','Desde borde izquierdo de primera pieza útil, incluye sierras exteriores');
  add('Canteadora',null,'Ancho completo',f(data.edger.width),'mm');add('Canteadora',null,'Kerf','4,2','mm');
  add('Canteadora',null,'Si no cabe','Armado completo → dos extremos → pieza más ancha que quepa → descarte');
  return '\ufeff'+rows.map(row=>row.map(value=>'"'+String(value).replaceAll('"','""')+'"').join(';')).join('\r\n');
}
