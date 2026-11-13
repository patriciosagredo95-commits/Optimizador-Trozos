// Motor puro del método de corte general de Modelo V2, en mm.
const BRANCH_DIAMETER_CM=36;
export const CUTTING_DEFAULTS=Object.freeze({x1:50,y1:100,x2:38,y2:75,x3:25,y3:50,med:true,a:26,c:2,m:2,e1:60,e2:75,cm:'75',cw:100,referenceDiameter:42});
const KC=3.4,KM=4.2,T=22,MINW=60,LOSS_OK=.10,LOSS_MAX=.25;
const numberFormats=new Map();
const fmt=(v,d=null)=>{
  if(!numberFormats.has(d))numberFormats.set(d,new Intl.NumberFormat('es-CL',{minimumFractionDigits:d??0,maximumFractionDigits:d??6}));
  return numberFormats.get(d).format(Number(v));
};
export function eqT(p){const ap=[[p.y2,p.x2],[p.y3,p.x3]].filter(a=>a[0]>0);return ap.length>0&&ap.every(a=>a[1]===p.x1);}
export function normalizeCuttingConfig(input={}) {
  const p={...CUTTING_DEFAULTS,...input};
  const val=(key,label,min,max,integer=false)=>{
    const raw=p[key], n=Number(raw);
    if(raw==='' || raw===null || typeof raw==='boolean' || !Number.isFinite(n) ||
       n<min || n>max || (integer && !Number.isInteger(n))) {
      throw new Error(`${label}: ingresa ${integer?'un entero':'un valor'} entre ${min} y ${max}.`);
    }
    p[key]=n;
  };
  for(const [i,label] of [[1,'Medida principal'],[2,'Primer aprovechamiento'],[3,'Segundo aprovechamiento']]) {
    val('x'+i,`${label}, espesor X${i}`,10,200);
    val('y'+i,`${label}, ancho Y${i}`,i===1?30:0,300);
  }
  if(typeof p.med!=='boolean') throw new Error('Médula: selecciona sí o no.');
  val('a','Médula, espesor a',10,120);
  val('c','Médula, cantidad c',1,6,true);
  val('m','Armado múltiple, cantidad m de piezas X1',0,40,true);
  if(p.med && p.m%2) throw new Error('Armado múltiple: m debe ser par al encerrar la médula.');
  if(![60,75].includes(Number(p.e1)) || ![60,75].includes(Number(p.e2))) {
    throw new Error('Canteadora: extremos de 60 o 75 mm.');
  }
  p.e1=Number(p.e1);
  p.e2=Number(p.e2);
  if(!['60','75','y1','otro'].includes(p.cm)) throw new Error('Canteadora: selecciona un centro válido.');
  if(p.cm==='y1' && p.x1!==22) throw new Error('Canteadora: centro Y1 disponible solo con X1 = 22 mm.');
  val('cw','Canteadora, otro ancho central',30,300);
  val('referenceDiameter','Diámetro de referencia',16,56,true);
  if(p.referenceDiameter%2) throw new Error('Diámetro de referencia: usa un diámetro par entre 16 y 56 cm.');
  return Object.fromEntries(Object.keys(CUTTING_DEFAULTS).map(k=>[k,p[k]]));
}
function layout(seq,k){const X=seq.reduce((t,q)=>t+q.w,0)+(seq.length-1)*k; let u=-X/2; seq.forEach(q=>{q.u0=u;q.u1=u+q.w;u=q.u1+k}); return {seq,X,s:seq.length-1,k};}
function armMain(p){
  const seq=[{t:'22',w:T},{t:'22',w:T}];
  if(p.med){const k=Math.floor(p.m/2); for(let i=0;i<k;i++)seq.push({t:'X1',w:p.x1}); for(let i=0;i<p.c;i++)seq.push({t:'a',w:p.a}); for(let i=0;i<k;i++)seq.push({t:'X1',w:p.x1});}
  else{for(let i=0;i<p.m;i++)seq.push({t:'X1',w:p.x1});}
  seq.push({t:'22',w:T},{t:'22',w:T});
  return layout(seq,KM);
}
function seqTxt(a){const out=[];let prev=null,cnt=0;a.seq.forEach(q=>{const l=q.t; if(l===prev)cnt++; else{if(prev)out.push(cnt>1?cnt+'×'+prev:prev); prev=l;cnt=1;}}); if(prev)out.push(cnt>1?cnt+'×'+prev:prev); return out.join(' – ');}

// ---------- geometría ----------
function status(u0,u1,v0,v1,R,ul){
  if(u1<=-ul||u0>=ul)return 'empty';
  const outU=u0<-ul-1e-6||u1>ul+1e-6;
  const c=[[u0,v0],[u0,v1],[u1,v0],[u1,v1]];
  if(!outU&&c.every(([u,v])=>u*u+v*v<=R*R+1e-6))return 'full';
  const nu=Math.max(u0,Math.min(0,u1)), nv=Math.max(v0,Math.min(0,v1));
  return (nu*nu+nv*nv>=R*R)?'empty':'wane';
}
function usable(u0,u1,v0,v1,R){const um=Math.max(Math.abs(u0),Math.abs(u1)); if(um>=R)return 0; const vl=Math.sqrt(R*R-um*um); return Math.max(0,Math.min(v1,vl)-Math.max(v0,-vl));}
function lossFrac(u0,u1,v0,v1,R,ul){const N=120;let a=0;const du=(u1-u0)/N;for(let i=0;i<N;i++){const u=u0+(i+.5)*du;if(Math.abs(u)>ul||Math.abs(u)>=R)continue;const h=Math.sqrt(R*R-u*u);a+=Math.max(0,Math.min(v1,h)-Math.max(v0,-h))*du;}return 1-a/((u1-u0)*(v1-v0));}
function chord(R,d){return Math.abs(d)>=R?0:2*Math.sqrt(R*R-d*d)}
function G(o,u0,u1,v0,v1){return o==='xu'?{x0:u0,x1:u1,y0:v0,y1:v1}:{x0:v0,x1:v1,y0:u0,y1:u1}}

// clasifica las piezas de un cuerpo según su armado
function fillBody(B,R){
  B.pieces=B.arm.seq.map(q=>{
    const st=status(q.u0,q.u1,B.v0,B.v1,R,B.ul); let cls='none';
    if(st!=='empty'){
      // Reglas de planta (2026-11-09), más estrictas que el prototipo V2 (que aceptaba hasta 10 % de pérdida):
      // · tabla de 22 sana: va a clasificación; si el cuerpo es Y1 y la principal tiene 22 mm de espesor,
      //   la tabla mide lo mismo que la principal (22 × Y1) y cuenta como medida principal;
      // · tabla de 22 con canto muerto: no da la medida, va a canteadora (ahí se saca 60/75 o se descarta);
      // · pieza de aprovechamiento con canto muerto: no da la medida y se descarta.
      if(q.t==='22'){const x1=B.arm.seq.find(s=>s.t==='X1')?.w; cls=st==='full'?(B.role==='Y1'&&x1===T?'prin':'clas'):'cant';}
      else if(B.role!=='Y1'){ const kind=q.t==='a'?'med':(B.role==='Y2'?'apr':'apr2'); cls=st==='full'?kind:'lost'; }
      else if(q.t==='a')cls=st==='full'?'med':'warn';
      else { const kind=q.t==='X1'?{Y1:'prin',Y2:'apr',Y3:'apr2'}[B.role]:(q.t==='X2'?'apr':'apr2'); cls=st==='full'?kind:'warn'; }
    }
    const pc={t:q.t,w:q.w,u0:q.u0,u1:q.u1,v0:B.v0,v1:B.v1,st,cls,body:B}; if(q.t==='22'&&st!=='empty')pc.loss=st==='full'?0:lossFrac(q.u0,q.u1,B.v0,B.v1,R,B.ul); return pc;
  });
  // se acepta el ancho si ninguna pieza de producto queda con canto muerto y sale al menos una pieza sana (las posiciones sin madera no cuentan)
  B.sane=B.role!=='Y1'?B.pieces.some(q=>q.cls==='apr'||q.cls==='apr2'):(B.pieces.filter(q=>q.t!=='22').every(q=>q.st!=='wane')&&B.pieces.some(q=>q.t!=='22'&&q.t!=='a'&&q.st==='full'));
}
function makeBody(p,R,A,name,role,o,v0,v1,ul){
  const B={name,role,o,v0,v1,ul};
  const crosses=v0<0&&v1>0; B.empty=!crosses&&Math.min(Math.abs(v0),Math.abs(v1))>=R;
  B.face=Math.min(chord(R,Math.max(Math.abs(v0),Math.abs(v1))),2*ul);
  // todas las basas y semibasas se cortan con el armado fijo de la múltiple
  B.mode='mult'; B.arm=A;
  if(B.empty){B.pieces=[];B.sane=false;} else fillBody(B,R);
  return B;
}
// tablas de 22 mm desde un lampazo: todas las que entreguen ancho útil para canteadora
function slabBoards(r,R,start,dir,o,vb,origin){
  for(let i=0;i<20;i++){
    const a=start+i*(T+KC), b=a+T;
    const u0=dir>0?a:-b, u1=dir>0?b:-a;
    const W=usable(u0,u1,vb[0],vb[1],R); if(W<MINW)break;
    r.boards.push({origin:origin+' · tabla '+(i+1),o,u0,u1,v0:vb[0],v1:vb[1]});
    const k0=dir>0?b:-b-KC, k1=dir>0?b+KC:-b; r.boardK.push(G(o,k0,k1,vb[0],vb[1]));
  }
}

// canteadora: armado fijo extremo – centro – extremo; si el ancho no alcanza, las piezas que quepan
// Regla de planta (2026-11-09): si la medida principal mide 22 mm de espesor, toda pieza de canteadora
// con el ancho de la principal (centro o extremos) cuenta como medida principal. Ej.: principal 22 × 75.
const cantKind=(w,p)=>p.x1===T&&w===p.y1?'prin':'clas';
function cantCenter(p){ if(p.cm==='60')return {w:60,k:cantKind(60,p),lab:'60'}; if(p.cm==='75')return {w:75,k:cantKind(75,p),lab:'75'}; if(p.cm==='y1'&&p.x1===T)return {w:p.y1,k:'prin',lab:'Y1 '+fmt(p.y1)}; return {w:p.cw,k:cantKind(p.cw,p),lab:fmt(p.cw)}; }
function cantPlan(W,p){
  const C=cantCenter(p), E1={w:p.e1,k:cantKind(p.e1,p),lab:String(p.e1)}, E2={w:p.e2,k:cantKind(p.e2,p),lab:String(p.e2)};
  if(W>=E1.w+C.w+E2.w+2*KM)return [E1,C,E2];
  if(W>=E1.w+E2.w+KM)return [E1,E2];
  const one=[C,E2,E1].filter(x=>x.w<=W).sort((a,b)=>b.w-a.w)[0];
  return one?[one]:[];
}
// Ø < 36 cm: la cara plana del carro se ubica para que el lampazo dé 1 o 2 tablas de 22 mm;
// dentro de ese rango se elige la posición que entrega más medida principal y mejor rendimiento
function better(a,b){return !b||a.nPrin>b.nPrin||(a.nPrin===b.nPrin&&a.yield>b.yield+1e-9);}
function candidatesFor(p){
  if(p.d>=BRANCH_DIAMETER_CM){
    return Array.from({length:Math.floor(armMain(p).seq.length/2)},(_,j)=>computeF(p,undefined,j));
  }
  const R=p.d*5,uMax=Math.sqrt(Math.max(0,R*R-(MINW/2)**2));
  const F1=uMax-(T+KC)-0.5,F3=uMax-3*(T+KC),candidates=[];
  for(let F=F1;F>F3;F-=2)candidates.push(computeF(p,Math.max(0,F)));
  return candidates;
}
function compute(p){
  return candidatesFor(p).reduce((best,candidate)=>better(candidate,best)?candidate:best,null);
}
function computeF(p,Fsel,drop=0){
  const R=p.d*10/2, big=p.d>=BRANCH_DIAMETER_CM, A=armMain(p);
  const r={R,big,A,bodies:[],boards:[],carroK:[],huinK:[],boardK:[],warn:[],block:null,skipped:[]};
  const tryAdd=(role,w,mk)=>{ if(!(w>0))return false; const B=mk(role,w); if(B.empty||!B.sane){r.skipped.push(role);return false;} return B; };
  if(big){
    const N=A.seq.length, X=A.seq[N-1-drop].u1-A.seq[drop].u0, ul=X/2; r.X=X; r.drop=drop; r.nIn=N-2*drop;
    if(ul>=R)r.warn.push(['crit','El ancho de basa ('+fmt(X,1)+' mm) supera el diámetro del trozo.']);
    // 1º: tantos Y1 como alcancen, centrados en la médula
    let stack=null;
    for(let n=12;n>=1;n--){
      const H=n*p.y1+(n-1)*KC; let v=-H/2; const bs=[];
      for(let i=0;i<n;i++){bs.push(makeBody(p,R,A,n>1?'Y1 · '+(i+1):'Y1','Y1','xu',v,v+p.y1,ul)); v+=p.y1+KC;}
      if(bs.every(B=>!B.empty&&B.sane)||n===1){stack=bs;break;}
    }
    if(!stack[0].sane)r.warn.push(['crit','Ni un ancho Y1 sale con piezas X1 sanas con este armado y diámetro.']);
    let yb=stack[0].v0;
    stack.forEach(B=>{r.bodies.push(B); r.huinK.push(G('xu',-ul,ul,B.v1,B.v1+KC));});
    let v=stack[stack.length-1].v1+KC;
    // 2º Y2, 3º Y3 (o Y3 si Y2 no alcanza)
    // se repite mientras alcance: Y2, y si Y2 no alcanza, Y3
    const c2={Y2:0,Y3:0};
    for(let g=0;g<12;g++){
      let added=false;
      for(const role of ['Y2','Y3']){
        const w=role==='Y2'?p.y2:p.y3;
        const B=tryAdd(role,w,(ro,ww)=>makeBody(p,R,A,ro+' · '+(c2[ro]+1),ro,'xu',v,v+ww,ul));
        if(B){r.bodies.push(B); r.huinK.push(G('xu',-ul,ul,B.v1,B.v1+KC)); v=B.v1+KC; c2[role]++; added=true; break;}
      }
      if(!added)break;
    }
    // bajo el grupo Y1 también se sacan semibasas de aprovechamiento mientras alcancen
    for(let g=0;g<12;g++){
      let added=false;
      for(const role of ['Y2','Y3']){
        const w=role==='Y2'?p.y2:p.y3;
        const B=tryAdd(role,w,(ro,ww)=>makeBody(p,R,A,ro+' · '+(c2[ro]+1),ro,'xu',yb-KC-ww,yb-KC,ul));
        if(B){r.bodies.push(B); r.huinK.push(G('xu',-ul,ul,B.v1,B.v1+KC)); yb=B.v0; c2[role]++; added=true; break;}
      }
      if(!added)break;
    }
    r.bodies.forEach(B=>{if((B.role==='Y2'||B.role==='Y3')&&c2[B.role]===1)B.name=B.role;});
    r.yb=yb;
    r.block={x0:-ul,x1:ul,y0:yb,y1:R};
    r.carroK.push({x0:ul,x1:ul+KC,y0:-R,y1:R},{x0:-ul-KC,x1:-ul,y0:-R,y1:R},{x0:-ul,x1:ul,y0:yb-KC,y1:yb});
    slabBoards(r,R,ul+KC,1,'xu',[-R,R],'Lampazo lateral derecho');
    slabBoards(r,R,ul+KC,-1,'xu',[-R,R],'Lampazo lateral izquierdo');
    slabBoards(r,R,-(yb-KC),-1,'yu',[-ul,ul],'Lampazo inferior');
    slabBoards(r,R,v,1,'yu',[-ul,ul],'Lampazo superior');
  }else{
    const F=Fsel; r.F=F; r.block={x0:-R,x1:F,y0:-R,y1:R};
    r.carroK.push({x0:F,x1:F+KC,y0:-R,y1:R});
    let x=F, n=0;
    const mk=(name,role,w)=>makeBody(p,R,A,name,role,'yu',x-w,x,R);
    const push=B=>{r.bodies.push(B); r.huinK.push({x0:B.v0-KC,x1:B.v0,y0:-R,y1:R}); x=B.v0-KC;};
    // 1er corte de huinchas: ancho Y1
    const cnt={Y1:0,Y2:0,Y3:0};
    const B1=mk('Y1 · 1','Y1',p.y1); push(B1); cnt.Y1=1;
    if(!B1.sane)r.warn.push(['crit','El primer ancho Y1 no sale con piezas X1 sanas con este armado y diámetro.']);
    // cortes siguientes: Y1 de nuevo; si se pierde madera, Y2; si se sigue perdiendo, Y3
    for(let g=0;g<12;g++){
      let added=false;
      for(const role of ['Y1','Y2','Y3']){
        const w={Y1:p.y1,Y2:p.y2,Y3:p.y3}[role]; if(!(w>0))continue;
        const B=mk(role+' · '+(cnt[role]+1),role,w);
        if(B.empty||!B.sane)continue;
        push(B); cnt[role]++; added=true; break;
      }
      if(!added)break;
    }
    r.bodies.forEach(B=>{if(cnt[B.role]===1)B.name=B.role;});
    slabBoards(r,R,F+KC,1,'xu',[-R,R],'Lampazo del carro');
    slabBoards(r,R,-x,-1,'xu',[-R,R],'Lampazo de huinchas');
  }
  // cortes de la múltiple / huinchas dentro de cada cuerpo
  r.pieces=[]; r.multK=[];
  r.bodies.forEach(B=>{
    B.pieces.forEach(q=>r.pieces.push(q));
    for(let i=0;i<B.pieces.length-1;i++){const a=B.pieces[i],b=B.pieces[i+1]; if(a.st!=='empty'||b.st!=='empty')r.multK.push({b:B,u0:a.u1,u1:b.u0});}
    const nW=B.pieces.filter(q=>q.cls==='warn'&&q.t!=='a').length, nA=B.pieces.filter(q=>q.cls==='warn'&&q.t==='a').length, nE=B.pieces.filter(q=>q.st==='empty'&&q.u0>-B.ul&&q.u1<B.ul).length;
    if(nW)r.warn.push(['warn',nW+' pieza'+(nW>1?'s':'')+' de producto con canto muerto en '+B.name+'.']);
    if(nA)r.warn.push(['warn','Las tablas centrales de '+B.name+' presentan canto muerto.']);
    if(nE&&B.mode==='mult')r.warn.push(['ok',nE+' posici'+(nE>1?'ones':'ón')+' del armado sin madera en '+B.name+'.']);
  });
  ['Y2','Y3'].forEach(ro=>{const w=ro==='Y2'?p.y2:p.y3; if(!(w>0)||r.bodies.some(B=>B.role===ro))return;
    r.warn.push(['ok', ro+' no alcanza en este diámetro; esa zona queda como lampazo.']);});
  const nLost=r.pieces.filter(q=>q.cls==='lost').length;
  if(nLost)r.warn.push(['warn',nLost+' pieza'+(nLost>1?'s':'')+' de aprovechamiento con canto muerto no da'+(nLost>1?'n':'')+' la medida y no se cuenta'+(nLost>1?'n':'')+' como producción.']);
  r.cant=[];
  r.pieces.filter(q=>q.cls==='cant').forEach(q=>r.cant.push({origin:q.body.name+' · tabla 22 '+(q.u0<0?'izquierda':'derecha'),W:usable(q.u0,q.u1,q.v0,q.v1,R),g:{o:q.body.o,u0:q.u0,u1:q.u1,v0:q.v0,v1:q.v1}}));
  r.boards.forEach(b=>r.cant.push({origin:b.origin,W:usable(b.u0,b.u1,b.v0,b.v1,R),g:{o:b.o,u0:b.u0,u1:b.u1,v0:b.v0,v1:b.v1}}));
  r.cant.forEach(c=>{c.plan=cantPlan(c.W,p); c.ok=c.plan.length>0;});
  const bad=r.cant.filter(c=>!c.ok).length;
  if(bad)r.warn.push(['warn',bad+' tabla'+(bad>1?'s':'')+' en canteadora no alcanza'+(bad>1?'n':'')+' ni para una pieza de 60 mm.']);
  const prod={}; const add=(k,label,sec,dest,area)=>{if(!prod[k])prod[k]={label,sec,dest,n:0,area:0};prod[k].n++;prod[k].area+=area;};
  r.pieces.forEach(q=>{const Y=q.v1-q.v0, sec=fmt(q.w)+' × '+fmt(Y);
    if(q.cls==='prin')add('prin','Medida principal',sec,'Producto',q.w*Y);
    if(q.cls==='apr')add('apr'+sec,'Primer aprovechamiento',sec,'Producto',q.w*Y);
    if(q.cls==='apr2')add('apr2'+sec,'Segundo aprovechamiento',sec,'Producto',q.w*Y);
    if(q.cls==='med')add('med'+sec,'Tabla central (médula)',sec,'Tabla central',q.w*Y);
    if(q.cls==='clas')add('clas'+Y,'Tabla de aprovechamiento','22 × '+fmt(Y),'Mesa de clasificación',T*Y);
  });
  r.nPrinCant=0;
  r.cant.forEach(c=>c.plan.forEach(pc=>{ if(pc.k==='prin'){r.nPrinCant++; add('prin','Medida principal',fmt(T)+' × '+fmt(pc.w),'Producto',T*pc.w);} else add('c'+pc.w,'Canteadora','22 × '+fmt(pc.w),'Mesa de clasificación',T*pc.w); }));
  r.pieces.filter(q=>q.cls==='lost').forEach(q=>add('lost'+q.w+'x'+(q.v1-q.v0),'Pieza con canto muerto (descartada)',fmt(q.w)+' × '+fmt(q.v1-q.v0),'Pérdida',0));
  r.prod=Object.values(prod); r.area=r.prod.reduce((t,x)=>t+x.area,0);
  r.vJAS=p.d*p.d*(p.length??4000)/1e7; r.vProd=r.area*(p.length??4000)/1e9; r.yield=r.vProd/r.vJAS;
  const cnt=c=>r.pieces.filter(q=>q.cls===c).length;
  r.nPrin=cnt('prin')+r.nPrinCant; r.nApr=cnt('apr'); r.nApr2=cnt('apr2'); r.nClas=cnt('clas'); r.nCant=r.cant.length;
  r.nLost=nLost; r.nLost22=r.pieces.filter(q=>q.cls==='lost'&&q.t==='22').length;
  r.nY1=r.bodies.filter(B=>B.role==='Y1').length;
  if(!r.warn.some(w=>w[0]!=='ok'))r.warn.unshift(['ok','Sin observaciones: el armado calza con el trozo.']);
  return r;
}
// sugerencia: cantidad de piezas X1 que maximiza la medida principal sana (y luego el rendimiento)
function suggestM(p){const step=p.med?2:1; let best=null;
  for(let m=0;m<=20;m+=step){const r=compute(Object.assign({},p,{m})); const sc=[r.nPrin,r.yield]; if(!best||sc[0]>best.sc[0]||(sc[0]===best.sc[0]&&sc[1]>best.sc[1]+1e-9))best={m,sc};}
  return best?best.m:0;}


export {KC,KM,T,MINW,LOSS_OK,LOSS_MAX,compute,computeF,armMain,fillBody,slabBoards,cantPlan,cantCenter,suggestM,status,usable,lossFrac,chord,G,seqTxt};

// Adapta la geometría del prototipo al contrato compartido por vista, pedido e informes.
export function solveLog(diameterCm,configuration,length=4000) {
  const p={...normalizeCuttingConfig(configuration),d:diameterCm,length};
  const candidates=candidatesFor(p);
  candidates.sort((a,b)=>a.nPrin!==b.nPrin ? b.nPrin-a.nPrin
    : Math.abs(a.yield-b.yield)>1e-9 ? b.yield-a.yield : 0);

  const adapt=raw=>{
    // Los primeros tres IDs mantienen la principal y ambos aprovechamientos.
    // Se usan las secciones físicas de X1, aun cuando X2/X3 difieran del programa.
    const products=[
      ['Medida principal',p.x1,p.y1,'prin'],
      ['Primer aprovechamiento',p.x1,p.y2,'apr'],
      ['Segundo aprovechamiento',p.x1,p.y3,'apr2']
    ].map(([label,thickness,width,cls],id)=>({
      id,label,thickness,width,area:thickness*width,
      active:width>0,role:id===0?'target':'recovery',cls
    }));
    const productFor=(cls,thickness,width)=>{
      if(['prin','apr','apr2'].includes(cls)) return {prin:0,apr:1,apr2:2}[cls];
      let found=products.find(q=>q.cls===cls && q.thickness===thickness && q.width===width);
      if(!found) {
        found={
          id:products.length,
          label:cls==='med'?'Tabla central (médula)':cls==='cant'?'Canteadora':'Tabla 22 a clasificación',
          thickness,width,area:thickness*width,active:true,role:'recovery',cls
        };
        products.push(found);
      }
      return found.id;
    };
    const pieces=[];
    const add=(cls,t,w,g,origin,bodyIndex=null)=>{
      pieces.push({
        x:g.x0,y:g.y0,w:g.x1-g.x0,h:g.y1-g.y0,
        productId:productFor(cls,t,w),cls,origin,bodyIndex,
        stage:origin==='canteadora'
          ? 'Carro huincha → huinchas → canteadora'
          : 'Carro huincha → huinchas → múltiple'
      });
    };
    raw.bodies.forEach((body,bodyIndex)=>{
      for(const q of body.pieces) {
        if(!['prin','apr','apr2','med','clas'].includes(q.cls)) continue;
        add(q.cls,q.w,q.v1-q.v0,G(body.o,q.u0,q.u1,q.v0,q.v1),'basa',bodyIndex);
      }
    });
    raw.cant.forEach(board=>{
      if(!board.ok) return;
      const {o,u0,u1,v0,v1}=board.g;
      const um=Math.max(Math.abs(u0),Math.abs(u1));
      const vl=Math.sqrt(Math.max(0,raw.R**2-um**2));
      const lo=Math.max(v0,-vl),hi=Math.min(v1,vl);
      const used=board.plan.reduce((sum,q)=>sum+q.w,0)+(board.plan.length-1)*KM;
      let v=lo+(hi-lo-used)/2;
      for(const q of board.plan) {
        add(q.k==='prin'?'prin':'cant',T,q.w,G(o,u0,u1,v,v+q.w),'canteadora');
        v+=q.w+KM;
      }
    });
    const counts=products.map(q=>({productId:q.id,quantity:pieces.filter(pc=>pc.productId===q.id).length}));
    const bodyIndex=body=>raw.bodies.indexOf(body);
    const clean=q=>{
      const {body,...pc}=q;
      return {...pc,bodyIndex:bodyIndex(body)};
    };
    // El prototipo agrupa todos los descartes como 22 mm. En los informes
    // se conserva la sección física de cada descarte, sin cambiar producción.
    const discarded=new Map();
    for(const piece of raw.pieces.filter(piece=>piece.cls==='lost')){
      const width=piece.v1-piece.v0,key=`${piece.w}x${width}`;
      if(!discarded.has(key))discarded.set(key,{
        label:'Pieza descartada',sec:`${fmt(piece.w)} × ${fmt(width)}`,
        dest:'Pérdida',n:0,area:0
      });
      discarded.get(key).n++;
    }
    const productionRows=[...raw.prod.filter(row=>row.dest!=='Pérdida'),...discarded.values()];
    // Las referencias por índice evitan ciclos al guardar o exportar el resultado.
    const cutting={
      ...raw,
      prod:productionRows,
      warn:raw.warn.map(([level,message])=>[level,message.includes('de 22 mm de la múltiple pierde')
        ? `${raw.nLost} piezas descartadas de la múltiple; no se cuentan como producción.`
        : message]),
      bodies:raw.bodies.map(body=>({...body,pieces:body.pieces.map(clean)})),
      pieces:raw.pieces.map(clean),
      multK:raw.multK.map(({b,...k})=>({...k,bodyIndex:bodyIndex(b)}))
    };
    const targetArea=products[0].area*counts[0].quantity;
    const cylinderVolume=Math.PI*raw.R**2*length/1e9;
    return {
      method:'v2',cutting,products,diameterCm,diameterMm:diameterCm*10,radius:raw.R,
      pieces,counts,bases:raw.bodies.map(body=>({...G(body.o,-body.ul,body.ul,body.v0,body.v1),width:body.face})),
      mask:raw.nPrin?1:0,volume:raw.vProd,targetVolume:targetArea*length/1e9,
      recoveryVolume:raw.vProd-targetArea*length/1e9,referenceVolume:raw.vJAS,
      cylinderVolume,yield:raw.yield*100,geometricYield:raw.vProd/cylinderVolume*100,
      recoveryCount:pieces.length-raw.nPrin-raw.nApr-raw.nApr2,totalCount:pieces.length,offset:0,
      evaluated:candidates.length,searchStepMm:null,status:pieces.length?'found':'no_pattern'
    };
  };
  const alternatives=candidates.slice(0,2).map(adapt);
  return {...alternatives[0],alternatives};
}

export const DIAMETERS=Object.freeze([16,18,20,22,24,26,28,30,32,34,36,38,40,42,44,46,48,50,52,54,56]);
export function normalizeConfig(input={}){
  const length=Number(input.length??4000);
  if(input.length===''||typeof input.length==='boolean'||input.length===null||!Number.isInteger(length)||length<500||length>12000){
    throw new Error('Largo del trozo: ingresa un entero entre 500 y 12000 mm.');
  }
  return {cutting:normalizeCuttingConfig(input.cutting??input.largeLog),length};
}
export function createOptimizer(input={}){
  const config=normalizeConfig(input);
  return {config,solve(diameterCm){
    if(!DIAMETERS.includes(diameterCm))throw new Error('El diámetro no pertenece al catálogo.');
    return solveLog(diameterCm,config.cutting,config.length);
  }};
}
export function assertGeometry(result,config){
  const tolerance=1e-4;
  for(const piece of result.pieces){
    const product=result.products[piece.productId];
    if(piece.w<=0||piece.h<=0||!product||Math.abs(piece.w*piece.h-product.area)>tolerance)throw new Error('Pieza con dimensiones inconsistentes.');
  }
  const volume=result.pieces.reduce((sum,piece)=>sum+piece.w*piece.h,0)*config.length/1e9;
  if(Math.abs(volume-result.volume)>1e-8)throw new Error('Volumen inconsistente.');
  for(let i=0;i<result.pieces.length;i++)for(let j=i+1;j<result.pieces.length;j++){
    const a=result.pieces[i],b=result.pieces[j];
    if(Math.min(a.x+a.w,b.x+b.w)-Math.max(a.x,b.x)>tolerance&&Math.min(a.y+a.h,b.y+b.h)-Math.max(a.y,b.y)>tolerance)throw new Error('Piezas superpuestas.');
  }
  return true;
}
