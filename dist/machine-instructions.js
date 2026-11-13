import {DIAMETERS, KC, KM, normalizeConfig, cantCenter} from './optimizer.js';
import {normalizeLot} from './run-planner.js';

// Sólo transforma geometría ya calculada. Todas las longitudes quedan en mm.
export function buildMachineInstructions({config, lot={}, results, date=''}) {
  const normalized=normalizeConfig(config), stock=normalizeLot(lot);
  const occupied=DIAMETERS.filter(d=>stock[d]>0);
  const diameters=occupied.length?occupied:DIAMETERS;
  const byDiameter=new Map(results.map(result=>[result.diameterCm,result.cutting??result]));
  const rows=diameters.map(diameterCm=>{
    const r=byDiameter.get(diameterCm);
    if(!r)throw new Error(`Falta la geometría de Ø ${diameterCm*10} mm.`);
    const lampazos=Object.fromEntries((r.big
      ?['Lampazo lateral derecho','Lampazo lateral izquierdo','Lampazo inferior','Lampazo superior']
      :['Lampazo del carro','Lampazo de huinchas']).map(origin=>[origin,0]));
    for(const board of r.boards){
      const origin=board.origin.split(' · tabla ')[0];
      lampazos[origin]=(lampazos[origin]??0)+1;
    }
    const bodies=r.bodies.filter(body=>!body.empty).map(body=>({
      role:body.role, width:body.v1-body.v0, from:body.v0, to:body.v1,
      orientation:body.o
    }));
    // F y X/2 son caras de madera retenida. El kerf del carro queda afuera.
    const cuts=r.carroK.map((g,index)=>{
      const vertical=g.x1-g.x0<=KC+1e-6;
      const lo=vertical?g.x0:g.y0,hi=vertical?g.x1:g.y1;
      const face=r.big?(index===0?lo:hi):lo;
      return {axis:vertical?'x':'y', face, sawCenter:(lo+hi)/2,
        barkThickness:r.R-Math.abs(face)};
    });
    return {diameter:diameterCm*10, qty:stock[diameterCm], radius:r.R,
      critical:r.warn.filter(([level])=>level==='crit').map(([,message])=>message),
      carriage:{big:r.big,cutCount:cuts.length,cuts,baseWidth:r.big?r.X:null,
        face:r.big?r.X/2:r.F,lowerFace:r.big?r.yb:null},
      bands:{bodies,lampazos},
      edger:{boards:r.cant.length,accepted:r.cant.filter(board=>board.ok).length,
        discarded:r.cant.filter(board=>!board.ok).length,
        pieces:r.cant.reduce((sum,board)=>sum+board.plan.length,0),
        plans:r.cant.map(board=>({origin:board.origin,usableWidth:board.W,
          widths:board.plan.map(piece=>piece.w)}))}
    };
  });
  const arm=byDiameter.get(diameters[0]).A;
  for(const diameter of diameters){
    const other=byDiameter.get(diameter).A;
    if(JSON.stringify(other.seq)!==JSON.stringify(arm.seq))throw new Error('La corrida debe usar un solo armado de múltiple.');
  }
  const pieces=arm.seq.map((piece,index)=>({number:index+1,label:piece.t,
    width:piece.w,start:piece.u0+arm.X/2,end:piece.u1+arm.X/2}));
  const saws=pieces.slice(0,-1).map(piece=>({number:piece.number,
    start:piece.end,center:piece.end+KM/2,end:piece.end+KM}));
  const p=normalized.cutting, widths=[p.e1,cantCenter(p).w,p.e2];
  let edge=0;
  const edgerPieces=widths.map((width,index)=>{
    const piece={label:['e1','centro','e2'][index],width,start:edge,end:edge+width};
    edge+=width+KM;return piece;
  });
  return {date,config:normalized,rows,totalLogs:rows.reduce((sum,row)=>sum+row.qty,0),
    catalogue:!occupied.length,
    multiple:{pieces,saws,width:arm.X,kerf:KM,sawCount:arm.s},
    edger:{pieces:edgerPieces,width:edge-KM,kerf:KM,
      // Incluye ambas sierras de despunte lateral, según edgerGeometry.
      sawCenters:[-KM/2,...edgerPieces.map(piece=>piece.end+KM/2)]},
    carriageKerf:KC};
}
