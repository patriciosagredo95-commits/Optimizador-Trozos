import {CUTTING_DEFAULTS, DIAMETERS, normalizeConfig, compute} from './optimizer.js';
export const MODEL_VERSION='analysis-3';
const n=v=>Number(v)||0;
export function parseEscuadria(desc){
 const m=String(desc??'').trim().match(/^(\d+(?:[.,]\d+)?)\s*[xX×]\s*(\d+(?:[.,]\d+)?)\s*[xX×]\s*(\d+(?:[.,]\d+)?)$/);
 if(!m)return null; const [espesor,ancho,largo]=m.slice(1).map(v=>Number(v.replace(',','.')));
 return espesor>0&&ancho>0&&largo>0?{espesor,ancho,largo}:null;
}
export function detectPrograms(productos=[]){
 const rows=productos.map(p=>({...parseEscuadria(p.esc),m3:n(p.m3)})).filter(p=>p.espesor&&p.m3>0);
 const groups=new Map();
 for(const p of rows.filter(p=>p.espesor!==22)){if(!groups.has(p.espesor))groups.set(p.espesor,[]);groups.get(p.espesor).push(p);}
 const centers=rows.filter(p=>p.espesor===22&&![60,75].includes(p.ancho));
 const own=centers.filter(p=>![...groups.values()].some(g=>g.some(q=>q.ancho===p.ancho)));
 if(own.length)groups.set(22,own);
 let programs=[...groups].map(([x1,products])=>{
 const widths=new Map(),lengths=new Map();for(const p of products){widths.set(p.ancho,(widths.get(p.ancho)||0)+p.m3);lengths.set(p.largo,(lengths.get(p.largo)||0)+p.m3);}
 const ranked=[...widths].sort((a,b)=>b[1]-a[1]||a[0]-b[0]).map(v=>v[0]);
 const center=centers.filter(p=>widths.has(p.ancho)).sort((a,b)=>b.m3-a.m3)[0];
 return {x1,x2:x1,x3:x1,y1:ranked[0],y2:ranked[1]||0,y3:ranked[2]||0,length:[...lengths].sort((a,b)=>b[1]-a[1])[0]?.[0]||4000,m3:products.reduce((s,p)=>s+p.m3,0),...(x1!==22&&center?{cm:'otro',cw:center.ancho}:{}),label:ranked.slice(0,3).map(w=>`${x1}×${w}`).join(' + ')};
 });
 if(!programs.length)programs=[{x1:22,x2:22,x3:22,y1:75,y2:0,y3:0,length:4000,m3:1,label:'22×75'}];
 const total=programs.reduce((s,p)=>s+p.m3,0);programs=programs.filter(p=>p.m3/total>=.1);
 const kept=programs.reduce((s,p)=>s+p.m3,0);programs.forEach(p=>p.weight=p.m3/kept);
 const mixto=programs.length>=2;
 return {programs,mixto,label:programs.map(p=>p.label+(mixto?` (${Math.round(p.weight*100)} %)`:'')).join(' · ')};
}
export function programConfig(program){
 const cutting={...CUTTING_DEFAULTS,...Object.fromEntries(['x1','y1','x2','y2','x3','y3','cm','cw'].filter(k=>program[k]!==undefined).map(k=>[k,program[k]]))};
 let error;for(const drop of [null,'y3','y2']){if(drop)cutting[drop]=0;try{return normalizeConfig({cutting,length:program.length||4000});}catch(e){error=e.message;}}
 return {error};
}
export const mapDiameter=d=>Math.min(56,Math.max(16,2*Math.floor((n(d)+1)/2)));
export function buildLot(diametros=[]){
 const lot=Object.fromEntries(DIAMETERS.map(d=>[d,0]));let total=0,outside=0;
 for(const p of diametros){lot[mapDiameter(p.d)]+=Math.max(0,Math.round(n(p.trozos)));total+=n(p.m3);if(n(p.d)<16||n(p.d)>56)outside+=n(p.m3);}
 return {lot,outOfRangePercent:total?100*outside/total:0};
}
export function theoreticalForDay(day,planRunFn){
 const consumo=n(day.consumo);if(consumo<=0)return null;
 const detected=detectPrograms(day.productos),{lot,outOfRangePercent}=buildLot(day.diametros),avisos=[],programs=[];
 if(outOfRangePercent>=1)avisos.push(`${outOfRangePercent.toLocaleString('es-CL',{maximumFractionDigits:1})} % de los m³ fuera del rango 16–56 cm; se usó el extremo más cercano.`);
 const fractions=new Map(),escuadrias=new Map();let yieldTeo=0,pesoOk=0;
 for(const p of detected.programs){const config=programConfig(p);try{
 if(config.error)throw Error(config.error);
 const candidate=planRunFn({config,lot,objective:'volume'}).candidates[0];
 const frac=new Map(candidate.rows.map(r=>[r.diameterCm,r.volumePerLog/r.referencePerLog]));
 const byDiameter=new Map();
 for(const row of candidate.rows){
 const result=compute({...candidate.config.cutting,d:row.diameterCm,length:candidate.config.length}),groups=new Map();
 // compute devuelve piezas en coordenadas locales; la canteadora aporta sus piezas terminadas aparte.
 const pieces=result.pieces.filter(q=>['prin','apr','apr2','med','clas'].includes(q.cls)).map(q=>({w:q.w,h:q.v1-q.v0}));
 for(const board of result.cant)for(const q of board.plan)pieces.push({w:22,h:q.w});
 for(const piece of pieces){const esc=`${Math.round(Math.min(piece.w,piece.h))}×${Math.round(Math.max(piece.w,piece.h))}`;groups.set(esc,(groups.get(esc)||0)+piece.w*piece.h*candidate.config.length*1e-9);}
 const sum=[...groups.values()].reduce((a,b)=>a+b,0),scale=sum&&Math.abs(sum-result.vProd)>result.vProd*.005?result.vProd/sum:1;
 byDiameter.set(row.diameterCm,new Map([...groups].map(([esc,v])=>[esc,v*scale/result.vJAS])));
 }
 for(const d of day.diametros||[])for(const [esc,f] of byDiameter.get(mapDiameter(d.d))||[])escuadrias.set(esc,(escuadrias.get(esc)||0)+p.weight*n(d.m3)/consumo*f);
 let m3=0;for(const d of day.diametros||[]){const f=frac.get(mapDiameter(d.d))||0;m3+=n(d.m3)*f;}
 for(const [d,f] of frac)fractions.set(d,(fractions.get(d)||0)+p.weight*f);
 yieldTeo+=p.weight*m3/consumo;pesoOk+=p.weight;const {m,med,cm,cw,e1,e2}=candidate.config.cutting;programs.push({...p,m,med,cm,cw,e1,e2});
 }catch(e){avisos.push(`${p.label}: sin modelo. ${e.message}`);programs.push({...p,error:e.message});}}
 // Si un programa no se pudo modelar, su peso se reparte entre los que sí; sin ninguno, no hay teórico.
 if(!pesoOk)return null;
 if(pesoOk<1){yieldTeo/=pesoOk;for(const [d,f] of fractions)fractions.set(d,f/pesoOk);}
 const m3Teo=yieldTeo*consumo,yieldReal=n(day.produccion)/consumo;
 return {porEscuadria:[...escuadrias].map(([esc,frac])=>({esc,frac:frac/pesoOk})),yieldTeo,m3Teo,yieldReal,desvPp:yieldReal-yieldTeo,desvM3:n(day.produccion)-m3Teo,...detected,programs,avisos,porDiametro:(day.diametros||[]).map(p=>({...p,frac:fractions.get(mapDiameter(p.d))||0,m3Teo:n(p.m3)*(fractions.get(mapDiameter(p.d))||0)}))};
}
export function periodStats(points=[]){
 const valid=points.filter(p=>n(p.consumo)>0&&Number.isFinite(p.yieldTeo)),N=valid.length;
 const sum=k=>valid.reduce((s,p)=>s+n(p[k]),0),cons=sum('consumo'),yieldReal=cons?sum('produccion')/cons:0,yieldTeo=cons?sum('m3Teo')/cons:0;
 const mean=N?valid.reduce((s,p)=>s+(p.yieldReal-p.yieldTeo)*100,0)/N:0;
 return {yieldReal,yieldTeo,desvPp:(yieldReal-yieldTeo)*100,promedioPp:mean,stdPp:N?Math.sqrt(valid.reduce((s,p)=>s+((p.yieldReal-p.yieldTeo)*100-mean)**2,0)/N):0,bajo:valid.filter(p=>p.yieldReal<p.yieldTeo).length,N,brechaM3:sum('produccion')-sum('m3Teo')};
}
export function hourlyCurves(hoy,yieldTeo){let real=0,teorico=0;return [...(hoy.horas||[])].sort((a,b)=>a.h.localeCompare(b.h)).map(p=>({h:p.h,real:real+=n(p.produccion),teorico:teorico+=n(p.consumo)*yieldTeo,trozos:n(p.trozos),trozosPLC:n(p.trozosPLC)}));}
export function cacheKey(day){const str=JSON.stringify([day.productos,day.diametros]);let hash=2166136261;for(let i=0;i<str.length;i++)hash=Math.imul(hash^str.charCodeAt(i),16777619);return `${MODEL_VERSION}:${day.f}:${hash>>>0}`;}

export const DEFAULT_TURNO={inicio:'08:00',fin:'16:30',colacion:['12:00','13:00']};
export const minuteOf=s=>{const a=String(s).split(':').map(Number);return a[0]*60+a[1];};
export function productiveMinutes(a,b,turno=DEFAULT_TURNO){turno={...DEFAULT_TURNO,...turno};const start=Math.max(a,minuteOf(turno.inicio)),end=Math.min(b,minuteOf(turno.fin));const [c,d]=turno.colacion.map(minuteOf);return Math.max(0,end-start)-Math.max(0,Math.min(end,d)-Math.max(start,c));}
const clockMinute=d=>{d=new Date(d);return d.getHours()*60+d.getMinutes()+d.getSeconds()/60;};
export function factorPLC(historico=[]){const days=historico.filter(d=>n(d.trozos)>0&&n(d.trozosPLC)>0);return days.length?Math.max(.9,Math.min(1.2,days.reduce((s,d)=>s+n(d.trozos),0)/days.reduce((s,d)=>s+n(d.trozosPLC),0))):1;}
export function jasPorTrozo(hoy,historico=[]){const d=n(hoy.trozos)>=20?hoy:[...historico].filter(d=>n(d.trozos)>0).sort((a,b)=>String(a.f).localeCompare(String(b.f))).at(-1);return d?n(d.consumo)/n(d.trozos):.45;}
// Perfil de registro al final de cada hora; los huecos conservan el acumulado anterior.
export function perfilRegistro(historico=[],turno=DEFAULT_TURNO,limite=30){
 turno={...DEFAULT_TURNO,...turno};
 const days=[...historico].filter(d=>n(d.produccion)>0&&n(d.trozosPLC)>0&&d.horas?.length).sort((a,b)=>String(b.f).localeCompare(String(a.f))).slice(0,limite);
 if(days.length<3)return {marcas:[],dias:days.length};
 const series=days.map(d=>{let r=0,p=0;const rows=[...d.horas].sort((a,b)=>a.h.localeCompare(b.h)).map(h=>({t:minuteOf(h.h)+60,r:r+=n(h.produccion),p:p+=n(h.trozosPLC)}));return {rows,R:Math.max(n(d.produccion),r),P:Math.max(n(d.trozosPLC),p)};});
 const marcas=[];
 for(let t=minuteOf(turno.inicio)+60;t<=minuteOf(turno.fin)+30;t+=60){
 const values=series.flatMap(d=>{const row=d.rows.filter(r=>r.t<=t).at(-1);return row&&row.p/d.P>=.05?[(row.r/d.R)/(row.p/d.P)]:[];}).sort((a,b)=>a-b);
 if(values.length>=3){const mid=Math.floor(values.length/2),k=values.length%2?values[mid]:(values[mid-1]+values[mid])/2;marcas.push({t:`${String(Math.floor(t/60)).padStart(2,'0')}:${String(t%60).padStart(2,'0')}`,k:Math.max(.5,Math.min(1.3,k)),n:values.length});}
 }
 return {marcas,dias:days.length};
}
export function factorRegistro(perfil,minutoDelDia){
 const rows=[...(perfil?.marcas||[])].sort((a,b)=>minuteOf(a.t)-minuteOf(b.t));if(!rows.length)return 1;
 if(minutoDelDia<=minuteOf(rows[0].t))return rows[0].k;
 for(let i=1;i<rows.length;i++)if(minutoDelDia<=minuteOf(rows[i].t)){const a=rows[i-1],b=rows[i];return a.k+(b.k-a.k)*(minutoDelDia-minuteOf(a.t))/(minuteOf(b.t)-minuteOf(a.t));}
 return rows.at(-1).k;
}
export function estadoDatos({ahora,conectado,ultimoContacto,hoyConsultado,intervaloMin=5,error,sensor,enTurno}){
 const age=v=>v==null?Infinity:(new Date(ahora)-new Date(v))/60000;
 const hora=v=>v==null?'—':new Date(v).toLocaleTimeString('es-CL',{hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
 if(!conectado&&age(ultimoContacto)>1)return {nivel:'critico',mensaje:`Sin conexión con el servicio PRD desde las ${hora(ultimoContacto)} (hace ${Math.floor(age(ultimoContacto))} min). Los números pueden estar desactualizados. Revisar que el PC del servicio esté encendido`,desde:ultimoContacto};
 if(conectado&&age(hoyConsultado)>Math.max(10,2.5*n(intervaloMin)))return {nivel:'critico',mensaje:`El PRD no se actualiza desde las ${hora(hoyConsultado)} (hace ${Math.floor(age(hoyConsultado))} min)${error?' · '+error:''}`,desde:hoyConsultado};
 if(enTurno&&sensor&&(['Sin señal','Sin sensor'].includes(sensor.estado)||age(sensor.visto)>10))return {nivel:'aviso',mensaje:`Contador PLC sin señal desde las ${hora(sensor.visto)}`,desde:sensor.visto};
 return {nivel:'ok',mensaje:'',desde:null};
}
export function liveToday(hoy,{yieldTeo=0,factor=1,jas=.45,porEscuadria=[],perfil,ahora=new Date()}={}){const registro=factorRegistro(perfil,typeof ahora==='number'?ahora:clockMinute(ahora));const trozosPLC=n(hoy.trozosPLC),trozosAjustados=trozosPLC*factor,consumoEst=trozosAjustados*jas,m3TeoBruto=consumoEst*yieldTeo,m3TeoReg=m3TeoBruto*registro,m3Teo=m3TeoReg,m3Real=n(hoy.produccion),difM3=m3Real-m3Teo,paqueteM3=n(hoy.tickets)>0?m3Real/n(hoy.tickets):3.5,tol=Math.max(paqueteM3,.02*m3Teo);let real=0,teo=0;return {porEscuadria:porEscuadria.map(p=>({...p,m3Teo:consumoEst*p.frac*registro})),registro,m3TeoBruto,m3TeoReg,trozosPLC,trozosAjustados,consumoEst,m3Teo,m3Real,difM3,difPct:m3Teo?100*difM3/m3Teo:0,rendReal:consumoEst*registro?m3Real/(consumoEst*registro):0,rendTeo:yieldTeo,paqueteM3,difPaquetes:paqueteM3?difM3/paqueteM3:0,semaforo:trozosPLC<30?'espera':difM3>tol?'sobre':difM3>=-tol?'bien':difM3>=-2*tol?'atento':'bajo',curvas:[...(hoy.horas||[])].sort((a,b)=>a.h.localeCompare(b.h)).map((p,i,rows)=>{const bruto=teo+=n(p.trozosPLC)*factor*jas*yieldTeo,t=i===rows.length-1?(typeof ahora==='number'?ahora:clockMinute(ahora)):minuteOf(p.h)+60;return {h:p.h,real:real+=n(p.produccion),teoBruto:bruto,teo:bruto*factorRegistro(perfil,t),trozosPLC:n(p.trozosPLC)};})};}
export function ritmo(hoy,historico=[],turno=DEFAULT_TURNO,ahora=new Date(),{factor=factorPLC(historico),jas=jasPorTrozo(hoy,historico),yieldTeo=0,perfil}={}){turno={...DEFAULT_TURNO,...turno};const t=clockMinute(ahora),elapsed=productiveMinutes(0,t,turno)/60,remaining=productiveMinutes(t,1440,turno)/60,total=productiveMinutes(0,1440,turno)/60,days=[...historico].filter(d=>n(d.trozosPLC)>0).sort((a,b)=>String(b.f).localeCompare(String(a.f))).slice(0,30),ritmoDia=elapsed?n(hoy.trozosPLC)/elapsed:0,h=Math.floor(t/60),hm=productiveMinutes(h*60,t,turno),hora=(hoy.horas||[]).find(p=>Math.floor(minuteOf(p.h)/60)===h),trozosProy=elapsed>=.5?n(hoy.trozosPLC)+ritmoDia*remaining:null;const actual=liveToday(hoy,{factor,jas,yieldTeo,perfil,ahora}),bruto=trozosProy===null?null:trozosProy*factor*jas*yieldTeo,cierre=bruto===null?null:bruto*factorRegistro(perfil,minuteOf(turno.fin));return {ritmoDia,ritmoHora:hm?n(hora?.trozosPLC)*60/hm:0,referencia:days.length&&total?days.reduce((s,d)=>s+n(d.trozosPLC),0)/(days.length*total):0,horasTranscurridas:elapsed,horasRestantes:remaining,trozosProy,m3TeoProyBruto:bruto,m3TeoProy:cierre,m3RealProy:cierre===null||!actual.m3TeoReg?null:cierre*actual.m3Real/actual.m3TeoReg};}
export function detectStops(samples=[],turno=DEFAULT_TURNO,ahora=new Date(),umbralMin=10){turno={...DEFAULT_TURNO,...turno};const now=new Date(ahora),day=now.toDateString(),rows=samples.map(p=>({...p,date:new Date(p.t)})).filter(p=>p.date.toDateString()===day&&p.date<=now).sort((a,b)=>a.date-b.date),paradas=[];let start=null,last=null;const flush=()=>{if(start&&last){const min=productiveMinutes(clockMinute(start.date),clockMinute(last.date),turno);if(min>=umbralMin)paradas.push({desde:start.t,hasta:last.t,min});}start=null;};for(const p of rows){const t=clockMinute(p.date);if(t<minuteOf(turno.inicio)||t>minuteOf(turno.fin)){flush();last=null;continue;}if(last&&(p.date-last.date)/60000<=15&&n(p.valor)<=n(last.valor)){start??=last;}else flush();last=p;}flush();const final=paradas.at(-1),detenida=!!(final&&last&&final.hasta===last.t&&(now-last.date)/60000<=6&&clockMinute(now)<=minuteOf(turno.fin));return {detenida,desde:detenida?final.desde:null,minutosActual:detenida?final.min:0,totalMin:paradas.reduce((s,p)=>s+p.min,0),paradas};}
export function productionByEscuadria(productos=[]){const groups=new Map();for(const p of productos){const d=parseEscuadria(p.esc);if(!d)continue;const esc=`${d.espesor}×${d.ancho}`,g=groups.get(esc)||{esc,m3:0,piezas:0,paq:0};g.m3+=n(p.m3);g.piezas+=n(p.piezas);g.paq+=n(p.paq??p.paquetes);groups.set(esc,g);}return [...groups.values()].sort((a,b)=>b.m3-a.m3);}
export function sameProgramStats(points,labelPrincipal,nDays=5){const key=p=>{const a=[...(p.programs||[])].sort((a,b)=>b.weight-a.weight)[0];return a?`${a.x1}×${a.y1}`:String(p.label||'').split(' ')[0];};const dias=[...points].filter(p=>key(p)===labelPrincipal&&n(p.consumo)>0).sort((a,b)=>String(b.f).localeCompare(String(a.f))).slice(0,nDays),cons=dias.reduce((s,p)=>s+n(p.consumo),0);return {yieldReal:cons?dias.reduce((s,p)=>s+n(p.yieldReal)*n(p.consumo),0)/cons:0,yieldTeo:cons?dias.reduce((s,p)=>s+n(p.yieldTeo)*n(p.consumo),0)/cons:0,dias};}
