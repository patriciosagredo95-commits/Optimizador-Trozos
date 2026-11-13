// Presentación de geometría calculada. No decide cortes ni modifica el resultado.
import {KC,KM,T,cantCenter} from './optimizer.js';

const fmt=(value,d=1)=>Number(value).toLocaleString('es-CL',{maximumFractionDigits:d});
const esc=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const rectOf=(o,u0,u1,v0,v1)=>o==='xu'?{x0:u0,x1:u1,y0:v0,y1:v1}:{x0:v0,x1:v1,y0:u0,y1:u1};
const sameRect=(a,b)=>['x0','x1','y0','y1'].every(k=>Math.abs(a[k]-b[k])<.001);
const plantRole=role=>({Y1:'Basa principal',Y2:'Semibasa de primer aprovechamiento',Y3:'Semibasa de segundo aprovechamiento'}[role]??'Basa');
const productName=cls=>({prin:'Medida principal',apr:'Primer aprovechamiento',apr2:'Segundo aprovechamiento',med:'Tabla central',clas:'Tabla a clasificación',cant:'Pieza de canteadora',warn:'Pieza con canto muerto',lost:'Pieza descartada'}[cls]??'Tabla');
const inputMeasure=board=>board?(board.W>0?`${fmt(T)} × ${fmt(board.W)} mm útiles`:`Espesor ${fmt(T)} mm · sin ancho útil`):`Espesor ${fmt(T)} mm · ancho variable`;
const stageNumber=stage=>stage===0?5:stage;
export const STAGE_NAMES=['Resultado final','Carro huincha','Huinchas','Múltiple','Canteadora'];
export const DESTINATION_STYLES=Object.freeze({
  toBands:{label:'A huinchas',color:'#D8BF87',pattern:'horizontal'},
  toMultiple:{label:'A múltiple',color:'#7BAFD0',pattern:'vertical'},
  cantInput:{label:'A canteadora',color:'#DF985C',pattern:'diagonal'},
  pith:{label:'Encierran la médula',color:'#8C5E3C',ink:'#F3DEC4',pattern:'rings'},
  finished:{label:'Producto final / clasificación',color:'#83B591',pattern:'dots'},
  lost:{label:'Desecho',color:'#ECE9E3',pattern:'cross'},
  bypass:{label:'No pasan por esta máquina',color:'#F1F1EF',pattern:'dots'}
});

// La marca «a» existe solo con médula encerrada, pero se repite en cada basa.
// Solo las c tablas centrales de la basa que contiene el origen la encierran.
// Si el centro cae en un corte entre basas no se elige una basa vecina.
const enclosesPith=(body,piece)=>piece.t==='a'&&body.v0<=0&&body.v1>=0&&body.ul>0;
const appearance=item=>item.destination==='bypass'?'bypass':item.enclosesPith?'pith':item.destination;
const pithNote=item=>item.enclosesPith?' · encierra la médula':'';
const PITH_BOX=Object.freeze({x0:-6,x1:6,y0:-6,y1:6});

// La canteadora centra el plan ya resuelto en el ancho útil de cada tabla.
function edgerParts(board,R){
  const {o,u0,u1,v0,v1}=board.g,um=Math.max(Math.abs(u0),Math.abs(u1));
  const vl=Math.sqrt(Math.max(0,R*R-um*um)),lo=Math.max(v0,-vl),hi=Math.min(v1,vl);
  const width=board.plan.reduce((sum,piece)=>sum+piece.w,0)+Math.max(0,board.plan.length-1)*KM;
  let v=lo+(hi-lo-width)/2;
  const pieces=[],cuts=[];
  if(board.ok){
    cuts.push(rectOf(o,u0,u1,v-KM,v));
    for(const piece of board.plan){
      pieces.push({g:rectOf(o,u0,u1,v,v+piece.w),thickness:T,width:piece.w,cls:piece.k==='prin'?'prin':'cant'});
      v+=piece.w;cuts.push(rectOf(o,u0,u1,v,v+KM));v+=KM;
    }
  }
  return {pieces,cuts};
}

export function stageViewModel(result,stage=0){
  const r=result.cutting,R=r.R,items=[],context=[],cuts=[],final=stage===0||stage===4;
  const findInput=g=>r.cant.find(board=>sameRect(rectOf(board.g.o,board.g.u0,board.g.u1,board.g.v0,board.g.v1),g));
  const add=(g,properties)=>{
    const pieceIndex=result.pieces.findIndex(piece=>sameRect({x0:piece.x,x1:piece.x+piece.w,y0:piece.y,y1:piece.y+piece.h},g));
    const active=!(stage===3&&properties.source==='bands'||stage===4&&properties.source==='multiple');
    const item={number:active?items.length+1:null,g,pieceIndex,...properties};
    item.measure??=`${fmt(item.thickness)} × ${fmt(item.width)} mm`;
    const exact=Number.isFinite(item.thickness)&&Number.isFinite(item.width)?` · Sección calculada: ${fmt(item.thickness,12)} × ${fmt(item.width,12)} mm`:'';
    item.tip=`${active?`Nº ${item.number}`:'No pasa por esta máquina'} · ${item.name}${pithNote(item)} · ${item.measure} → ${DESTINATION_STYLES[item.destination].label}${exact}${item.technical?` · ${item.technical}`:''}`;
    if(active)items.push(item);else context.push({...item,destination:'bypass'});
  };
  if(stage===1){
    add(r.block,{name:r.big?'Basa preparada':'Trozo con cara plana',destination:'toBands',measure:r.big?`Ancho de basa ${fmt(r.X)} mm`:`Ancho máximo del bloque ${fmt(r.block.x1-r.block.x0)} mm`,shortMeasure:r.big?`${fmt(r.X)} mm de ancho`:'Cara plana preparada'});
    const slabs=r.big?[
      [{x0:r.block.x1+KC,x1:R,y0:-R,y1:R},'Lampazo lateral derecho'],
      [{x0:-R,x1:r.block.x0-KC,y0:-R,y1:R},'Lampazo lateral izquierdo'],
      [{x0:r.block.x0,x1:r.block.x1,y0:-R,y1:r.block.y0-KC},'Lampazo inferior']
    ]:[[{x0:r.block.x1+KC,x1:R,y0:-R,y1:R},'Lampazo del carro']];
    for(const [g,name] of slabs)if(g.x1>g.x0&&g.y1>g.y0)add(g,{name,destination:'toBands',measure:'Sección curva · espesor variable',shortMeasure:'Lampazo'});
  }else if(stage===2){
    for(const body of r.bodies){
      if(body.empty)continue;
      add(rectOf(body.o,-body.ul,body.ul,body.v0,body.v1),{name:plantRole(body.role),destination:'toMultiple',measure:`Ancho ${fmt(body.v1-body.v0)} mm · frente ${fmt(2*body.ul)} mm`,shortMeasure:`Ancho ${fmt(body.v1-body.v0)} mm`,technical:body.name});
    }
    for(const board of r.boards){
      const g=rectOf(board.o,board.u0,board.u1,board.v0,board.v1),input=findInput(g);
      add(g,{name:'Tabla de lampazo',destination:'cantInput',thickness:T,width:input?.W??0,measure:inputMeasure(input),technical:board.origin});
    }
  }else{
    for(const body of r.bodies){
      if(body.empty)continue;
      for(const piece of body.pieces){
        if(piece.st==='empty'||final&&piece.cls==='cant')continue;
        const g=rectOf(body.o,piece.u0,piece.u1,piece.v0,piece.v1);
        add(g,{name:productName(piece.cls),enclosesPith:enclosesPith(body,piece),destination:['lost','warn','none'].includes(piece.cls)?'lost':piece.cls==='cant'?'cantInput':'finished',thickness:piece.w,width:body.v1-body.v0,technical:`${body.name} · pieza ${body.arm.seq.indexOf(body.arm.seq.find(q=>Math.abs(q.u0-piece.u0)<.001))+1} del armado`,source:'multiple'});
      }
    }
    if(final){
      for(const board of r.cant){
        const geometry=edgerParts(board,R);
        if(!board.ok){add(rectOf(board.g.o,board.g.u0,board.g.u1,board.g.v0,board.g.v1),{name:'Tabla descartada',destination:'lost',thickness:T,width:board.W,measure:inputMeasure(board),source:'edger',technical:board.origin});continue;}
        for(const piece of geometry.pieces)add(piece.g,{...piece,name:productName(piece.cls),destination:'finished',source:'edger',technical:board.origin});
      }
    }else{
      for(const board of r.boards){
        const g=rectOf(board.o,board.u0,board.u1,board.v0,board.v1),input=findInput(g);
        add(g,{name:'Tabla de lampazo (desde huinchas)',destination:'cantInput',thickness:T,width:input?.W??0,measure:inputMeasure(input),source:'bands',technical:board.origin});
      }
    }
  }
  const addCuts=(geometries,machine,kerf)=>geometries.forEach(g=>cuts.push({g,machine,kerf,active:stage!==0&&machine===['','carriage','bands','multiple','edger'][stage]}));
  addCuts(r.carroK,'carriage',KC);
  if(stage!==1)addCuts([...r.huinK,...r.boardK],'bands',KC);
  if(stage===0||stage>=3)addCuts(r.multK.map(cut=>{const body=r.bodies[cut.bodyIndex];return rectOf(body.o,cut.u0,cut.u1,body.v0,body.v1);}), 'multiple',KM);
  if(final)addCuts(r.cant.flatMap(board=>edgerParts(board,R).cuts),'edger',KM);
  return {stage,step:stageNumber(stage),name:STAGE_NAMES[stage],radius:R,items,context,cuts,blockWidth:r.block.x1-r.block.x0,baseWidth:r.big?r.X:null};
}

export function productionLegend(result,stage=0){
  if(!result?.cutting)return [];
  const counts={};
  const view=stageViewModel(result,stage);
  for(const item of [...view.items,...view.context]){const key=appearance(item);counts[key]=(counts[key]??0)+1;}
  return Object.entries(DESTINATION_STYLES).filter(([key])=>counts[key]||key==='lost').map(([key,style])=>[key,style.label,counts[key]??0]);
}
export function stageLegendHTML(result,stage=0){
  return productionLegend(result,stage).map(([key,label,count])=>`<span><i class="destination-swatch destination-${key}" style="--destination-color:${DESTINATION_STYLES[key].color}"></i>${esc(label)}${count?` <b>${count}</b>`:''}</span>`).join('')+'<span><i class="stage-pith-swatch"></i>Médula</span>';
}
export function stageArmWidths(result,stage,config){
  if(stage===3)return result.cutting.A.seq.map(piece=>piece.w);
  if(stage===4&&config?.cutting){const p=config.cutting;return [p.e1,cantCenter(p).w,p.e2];}
  return [];
}
const quantity=(count,singular,plural)=>count?`${count} ${count===1?singular:plural}`:'';
const joined=parts=>parts.filter(Boolean).join(' y ');
export function stageSummary(result,stage=0){
  const r=result.cutting,view=stageViewModel(result,stage);
  const count=(predicate)=>view.items.filter(predicate).length;
  const bodies=r.bodies.filter(body=>!body.empty);
  const origins=joined([
    quantity(r.boards.length,'tabla de lampazo','tablas de lampazo'),
    quantity(r.cant.length-r.boards.length,'tabla de la múltiple','tablas de la múltiple')
  ]);
  let text;
  if(stage===1)text=`${quantity(r.carroK.length,'corte','cortes')} para ${r.big?'preparar la basa':'abrir una cara plana'}. Continúan a huinchas ${joined([quantity(count(i=>!i.name.startsWith('Lampazo')),r.big?'basa preparada':'trozo con cara plana',r.big?'basas preparadas':'trozos con cara plana'),quantity(count(i=>i.name.startsWith('Lampazo')),'lampazo','lampazos')])}.`;
  if(stage===2){
    const output=joined([quantity(bodies.filter(b=>b.role==='Y1').length,'basa principal para la múltiple','basas principales para la múltiple'),quantity(bodies.filter(b=>b.role!=='Y1').length,'semibasa para la múltiple','semibasas para la múltiple'),quantity(r.boards.length,'tabla de lampazo para canteadora','tablas de lampazo para canteadora')]);
    text=output?`Se ${bodies.length+r.boards.length===1?'separa':'separan'} ${output}.`:'Sin piezas para separar.';
  }
  if(stage===3||stage===0){
    const outputs=joined([quantity(count(i=>i.destination==='finished'),'pieza terminada','piezas terminadas'),quantity(count(i=>i.destination==='cantInput'),'tabla para canteadora','tablas para canteadora'),quantity(count(i=>i.destination==='lost'),'pieza descartada','piezas descartadas')]);
    text=outputs?`Se ${view.items.length===1?'obtiene':'obtienen'} ${outputs}.`:'Sin piezas de salida.';
    if(stage===3&&bodies.length)text=`El mismo armado corta ${joined([quantity(bodies.filter(b=>b.role==='Y1').length,'basa principal','basas principales'),quantity(bodies.filter(b=>b.role!=='Y1').length,'semibasa','semibasas')])}. ${text}`;
  }
  if(stage===4)text=origins?`Se limpian los cantos de ${origins}. ${joined([quantity(count(i=>i.destination==='finished'),'pieza aprovechada','piezas aprovechadas'),quantity(count(i=>i.destination==='lost'),'tabla descartada','tablas descartadas')])}.`:'Sin tablas para cantear.';
  return `${stageNumber(stage)} · ${STAGE_NAMES[stage]}. ${text}`;
}
export function stageOutputsHTML(result,stage=0,config){
  const view=stageViewModel(result,stage),groups=new Map();
  const items=stage===3?view.items.filter(item=>item.source!=='bands'):stage===4?view.items.filter(item=>item.source==='edger'):view.items;
  for(const item of items){
    const dimensions=[item.thickness,item.width].map(value=>Number.isFinite(value)?value.toFixed(6):'').join('|');
    const key=`${appearance(item)}|${item.name}|${dimensions}|${item.measure}`,group=groups.get(key);
    if(group)group.quantity++;else groups.set(key,{...item,quantity:1});
  }
  const title=stage===0?'Qué se obtiene del trozo':'Qué sale de esta máquina';
  const arm=stageArmWidths(result,stage,config);
  return `<section class="stage-output" aria-label="${title}"><h4>${title}</h4><ul>${[...groups.values()].map(group=>`<li><i class="destination-swatch destination-${appearance(group)}" style="--destination-color:${DESTINATION_STYLES[appearance(group)].color}"></i><strong>${group.quantity}</strong><span>${esc(group.name)}<small>${esc(group.measure)} · ${esc(DESTINATION_STYLES[group.destination].label)}${pithNote(group)}</small></span></li>`).join('')}</ul>${arm.length?`<p class="stage-arm-note">Armado: ${arm.map(w=>fmt(w)).join(' · ')} mm; cada corte ${fmt(KM)} mm${stage===4?'. Si el ancho no alcanza, salen las piezas que caben':''}.</p>`:''}<p class="stage-output-note">${esc(stageSummary(result,stage))} Recortes y aserrín van a desecho, indicado con trama cruzada.</p></section>`;
}
export function stagePieceGroups(result,stage=0){
  const groups=new Map();
  for(const item of stageViewModel(result,stage).items){
    const key=JSON.stringify([item.name,item.measure,item.destination,!!item.enclosesPith]);
    if(!groups.has(key))groups.set(key,{...item,numbers:[]});
    groups.get(key).numbers.push(item.number);
  }
  return [...groups.values()].sort((a,b)=>a.number-b.number);
}
export function compactNumbers(numbers){
  const ranges=[];
  for(let i=0;i<numbers.length;i++){
    const start=numbers[i];let end=start;
    while(numbers[i+1]===end+1){end=numbers[++i];}
    ranges.push(end-start>=2?`${start}–${end}`:end===start?`${start}`:`${start}, ${end}`);
  }
  return ranges.join(', ');
}
export function stagePieceListHTML(result,stage=0){
  const view=stageViewModel(result,stage);
  return `<details class="stage-piece-key" open><summary>Medidas y destino de cada número (${view.items.length})</summary><p>Piezas iguales agrupadas; los números corresponden al dibujo. Sección: espesor × ancho, en milímetros. Los anchos útiles de tablas con canto muerto se indican expresamente.</p><ol>${stagePieceGroups(result,stage).map(item=>`<li value="${item.number}"><b>${compactNumbers(item.numbers)}</b><span>${item.numbers.length} × ${esc(item.name)}<strong>${esc(item.measure)}</strong><small>${esc(DESTINATION_STYLES[item.destination].label)}${pithNote(item)}</small></span></li>`).join('')}</ol></details>`;
}

const inside=(x,y,R)=>x*x+y*y<=R*R+.001;
const intersect=(a,b,gap=1)=>a.x0<b.x1+gap&&a.x1+gap>b.x0&&a.y0<b.y1+gap&&a.y1+gap>b.y0;

// Un plano constante permite comprobar las etiquetas sin navegador ni medir fuentes.
// Las etiquetas grandes se prueban dentro de la madera. Las angostas usan un número
// y la lista de medidas. Si no cabe ni el número, se lleva a un carril exterior.
export function stageLabelLayout(result,stage=0,config){
  const model=stageViewModel(result,stage),scale=220/model.radius,placed=[],outside=[];
  for(const item of model.items){
    const g={x0:item.g.x0*scale,x1:item.g.x1*scale,y0:-item.g.y1*scale,y1:-item.g.y0*scale};
    const number=String(item.number),badgeW=Math.max(15,number.length*6.2+4),badgeH=15;
    const dimension=item.shortMeasure??item.measure;
    const fullW=Math.max(50,dimension.length*5.9+12),fullH=33;
    let label=null;
    for(const full of [true,false]){
      const w=full?fullW:badgeW,h=full?fullH:badgeH,inset=full?1:.25;
      if(g.x1-g.x0<w+2*inset||g.y1-g.y0<h+2*inset)continue;
      const xs=[(g.x0+g.x1)/2,g.x0+w/2+inset,g.x1-w/2-inset];
      const ys=[(g.y0+g.y1)/2,g.y0+h/2+inset,g.y1-h/2-inset];
      for(const y of ys){for(const x of xs){
        const box={x0:x-w/2,x1:x+w/2,y0:y-h/2,y1:y+h/2};
        if(!intersect(box,PITH_BOX)&&[[box.x0,box.y0],[box.x1,box.y0],[box.x0,box.y1],[box.x1,box.y1]].every(([px,py])=>inside(px,py,219))&&!placed.some(other=>intersect(box,other.box))){label={number:item.number,x,y,w,h,box,full,dimension,external:false};break;}
      }if(label)break;}
      if(label)break;
    }
    if(label)placed.push(label);else outside.push({item,g});
  }
  for(const side of [-1,1]){
    const group=outside.filter(({g})=>((g.x0+g.x1)/2<0?-1:1)===side).sort((a,b)=>(a.g.y0+a.g.y1)-(b.g.y0+b.g.y1));
    const rows=24,columns=Math.ceil(group.length/rows);
    group.forEach(({item,g},i)=>{
      const column=Math.floor(i/rows),row=i%rows,count=Math.min(rows,group.length-column*rows),x=side*(251+column*24),y=(row-(count-1)/2)*18;
      const cx=(g.x0+g.x1)/2,cy=(g.y0+g.y1)/2;
      // Punto dentro de la parte visible de una pieza recortada por la circunferencia.
      const ax=Math.max(g.x0+.1,Math.min(0,g.x1-.1)),ay=Math.max(g.y0+.1,Math.min(0,g.y1-.1));
      let t=1;
      while(t>0&&!inside(ax+(cx-ax)*t,ay+(cy-ay)*t,218))t-=.05;
      placed.push({number:item.number,x,y,w:19,h:15,box:{x0:x-9.5,x1:x+9.5,y0:y-7.5,y1:y+7.5},full:false,dimension:item.measure,external:true,anchor:{x:ax+(cx-ax)*Math.max(0,t),y:ay+(cy-ay)*Math.max(0,t)}});
    });
  }
  // Carril exclusivo para el armado, entre la cota del diámetro y el trozo.
  // Cada tramo reserva el ancho de su texto incluso con armados muy largos.
  const widths=stageArmWidths(result,stage,config),total=widths.reduce((a,b)=>a+b,0);
  const spans=widths.map(w=>Math.max(w*Math.min(1,430/total),fmt(w).length*6.5+12));
  let cursor=-spans.reduce((a,b)=>a+b,0)/2;
  const chain=widths.map((width,i)=>{
    const left=cursor,right=cursor+spans[i];cursor=right;
    return {width,left,right,x:(left+right)/2,y:-257,box:{x0:left+2,x1:right-2,y0:-280,y1:-263}};
  });
  const dimensions=[{box:{x0:-220,x1:220,y0:-332,y1:-305}},...(chain.length?[{box:{x0:-50,x1:50,y0:-300,y1:-284}}]:[]),...chain.map(q=>({box:q.box})),{box:{x0:-220,x1:220,y0:233,y1:264}}];
  return {model,scale,labels:placed.sort((a,b)=>a.number-b.number),chain,dimensions,extent:Math.max(298,...placed.map(label=>Math.abs(label.x)+label.w/2+8),...chain.map(q=>Math.abs(q.x)+(q.right-q.left)/2+8))};
}

export function stageSVG(result,config,stage=4,id='cut-stage'){
  const layout=stageLabelLayout(result,stage,config),{model,scale,labels,extent,chain}=layout;
  const token=String(id).replace(/[^\w-]/g,''),clip=`clip-${token}`,pattern=key=>`destination-${token}-${key}`;
  const parts=[`<svg xmlns="http://www.w3.org/2000/svg" class="stage-drawing" viewBox="${-extent} -342 ${extent*2} 628" role="img" aria-labelledby="title-${token} desc-${token}" style="font-family:Arial,Helvetica,sans-serif"><title id="title-${token}">${model.step}. ${esc(model.name)} · trozo de ${result.diameterCm} cm</title><desc id="desc-${token}">Números de piezas y medidas en la lista bajo el dibujo. Trazo continuo oscuro: corte de esta máquina. Trazo fino discontinuo: cortes anteriores. Desecho con trama cruzada. Piezas atenuadas sin número: no pasan por esta máquina.</desc><defs><clipPath id="${clip}"><circle r="220"/></clipPath>`];
  for(const [key,style] of Object.entries(DESTINATION_STYLES)){
    if(key==='pith'&&!model.items.some(item=>item.enclosesPith))continue;
    const mark=style.pattern==='rings'?'<circle cx="4" cy="4" r="2.3" fill="none"/>':style.pattern==='dots'?'<circle cx="4" cy="4" r=".8"/>':style.pattern==='cross'?'<path d="M-2 2L2-2M0 8L8 0M6 10L10 6M-2 6L2 10M0 0L8 8M6-2L10 2"/>':style.pattern==='diagonal'?'<path d="M-2 2L2-2M0 8L8 0M6 10L10 6"/>':style.pattern==='vertical'?'<path d="M4 0V8"/>':'<path d="M0 4H8"/>';
    parts.push(`<pattern id="${pattern(key)}" width="8" height="8" patternUnits="userSpaceOnUse"><rect width="8" height="8" fill="${style.color}"/><g fill="${style.ink||'#314352'}" stroke="${style.ink||'#314352'}" stroke-width=".55" opacity="${key==='pith'?'.55':key==='lost'?'.36':'.19'}">${mark}</g></pattern>`);
  }
  parts.push(`</defs><g clip-path="url(#${clip})"><circle r="220" fill="url(#${pattern('lost')})" tabindex="0" role="img" data-tip="Desecho: recortes, canto muerto y aserrín; sin cantidad de piezas calculada" aria-label="Desecho hachurado"/>`);
  for(const item of [...model.context,...model.items]){
    const {g}=item;
    parts.push(`<rect x="${g.x0*scale}" y="${-g.y1*scale}" width="${(g.x1-g.x0)*scale}" height="${(g.y1-g.y0)*scale}" fill="url(#${pattern(appearance(item))})" stroke="${item.number?'#344A59':'#A7ACAD'}" stroke-width="${item.number?'1':'.5'}"${item.number?` data-stage-piece="${item.number}"`:' opacity=".42" data-stage-context="true"'} data-destination="${item.destination}" data-encloses-pith="${!!item.enclosesPith}" data-appearance="${appearance(item)}" tabindex="0" role="${item.pieceIndex>=0?'button':'img'}"${item.pieceIndex>=0?` data-piece="${item.pieceIndex}"`:''} data-tip="${esc(item.tip)}" aria-label="${esc(item.tip)}"><title>${esc(item.tip)}</title></rect>`);
  }
  // Un corte se dibuja una sola vez: su centro. Su espesor real queda en la ayuda.
  for(const cut of model.cuts){
    const g=cut.g,vertical=g.x1-g.x0<=cut.kerf+.001;
    const tip=`${({carriage:'Carro huincha',bands:'Huinchas',multiple:'Múltiple',edger:'Canteadora'})[cut.machine]} · ancho de corte ${fmt(cut.kerf)} mm · ${cut.active?'corte de esta máquina':'corte anterior'}`;
    const x1=(vertical?(g.x0+g.x1)/2:g.x0)*scale,x2=(vertical?(g.x0+g.x1)/2:g.x1)*scale,y1=-(vertical?g.y0:(g.y0+g.y1)/2)*scale,y2=-(vertical?g.y1:(g.y0+g.y1)/2)*scale;
    parts.push(`<line x1="${x1}" x2="${x2}" y1="${y1}" y2="${y2}" fill="none" stroke="${cut.active?'#8F2727':'#63717B'}" stroke-width="${cut.active?'1.7':'.75'}"${cut.active?'':' stroke-dasharray="3 3" opacity=".5"'} data-machine="${cut.machine}" data-cut-state="${cut.active?'current':'previous'}" tabindex="0" role="img" data-tip="${esc(tip)}" aria-label="${esc(tip)}"><title>${esc(tip)}</title></line>`);
  }
  parts.push('</g><circle r="220" fill="none" stroke="#3B4D58" stroke-width="1"/>');
  for(const label of labels){
    if(label.external)parts.push(`<path d="M${label.anchor.x} ${label.anchor.y}L${label.x-Math.sign(label.x)*12} ${label.y}" fill="none" stroke="#52616A" stroke-width=".7"/><circle cx="${label.anchor.x}" cy="${label.anchor.y}" r="1.7" fill="#34485A"/>`);
  }
  for(const label of labels){
    parts.push(`<g class="stage-label" data-label="${label.number}" data-label-placement="${label.external?'external':label.full?'measure':'number'}" pointer-events="none"><rect x="${label.box.x0}" y="${label.box.y0}" width="${label.w}" height="${label.h}" rx="3" fill="#fff" fill-opacity=".94" stroke="#71808B" stroke-width=".5"/><text x="${label.x}" y="${label.y+(label.full?-4:3.5)}" text-anchor="middle" fill="#142D3D" font-size="${label.full?12:10.5}" font-weight="700">${label.full?'Nº ':''}${label.number}</text>${label.full?`<text x="${label.x}" y="${label.y+10}" text-anchor="middle" fill="#142D3D" font-size="11">${esc(label.dimension)}</text>`:''}</g>`);
  }
  parts.push('<g data-pith-marker="true" tabindex="0" role="img" data-tip="Médula · centro del trozo" aria-label="Médula · centro del trozo"><title>Médula · centro del trozo</title><circle r="5" fill="#fff"/><circle r="2.6" fill="#1E2A2F"/></g>');
  // Dos cotas exteriores separadas de las piezas y de sus rótulos.
  const width=model.baseWidth??model.blockWidth,x0=result.cutting.block.x0*scale,x1=result.cutting.block.x1*scale;
  const dimension=(left,right,y,text)=>parts.push(`<g class="stage-dimension" fill="#263D4D" stroke="#52616A" stroke-width=".8"><path d="M${left} ${y-5}v10M${left} ${y}H${right}M${right} ${y-5}v10"/><text x="${(left+right)/2}" y="${y-8}" stroke="none" text-anchor="middle" font-size="13" font-weight="700">${esc(text)}</text></g>`);
  dimension(-220,220,-310,`Diámetro del trozo ${result.diameterCm} cm`);
  if(chain.length){
    parts.push(`<g class="stage-arm-chain" aria-label="Armado: ${chain.map(q=>fmt(q.width)).join(' · ')} mm; cada corte ${fmt(KM)} mm"><title>Armado en orden de sierra, en mm; cada corte ${fmt(KM)} mm</title><text x="0" y="-288" text-anchor="middle" fill="#263D4D" font-size="11">Armado (mm)</text>`);
    for(const q of chain)parts.push(`<g data-arm-width="${q.width}" fill="#263D4D" stroke="#52616A" stroke-width=".8"><path d="M${q.left} ${q.y-4}v8M${q.left} ${q.y}H${q.right}M${q.right} ${q.y-4}v8"/><text x="${q.x}" y="-267" stroke="none" text-anchor="middle" font-size="11" font-weight="700">${fmt(q.width)}</text></g>`);
    parts.push('</g>');
  }
  dimension(x0,x1,258,`${model.baseWidth?'Ancho de basa':'Ancho máximo del bloque'} ${fmt(width)} mm`);
  parts.push('</svg>');
  return parts.join('');
}
