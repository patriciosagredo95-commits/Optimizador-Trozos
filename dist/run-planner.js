import {DIAMETERS,normalizeConfig,compute} from './optimizer.js';

export function normalizeLot(lot={}){
  return Object.fromEntries(DIAMETERS.map(d=>{
    const raw=lot instanceof Map?lot.get(d):lot?.[d];
    const qty=Number(raw??0);
    if(typeof raw==='boolean'||!Number.isSafeInteger(qty)||qty<0||qty>10000)throw new Error(`Trozos de ${d} cm. Ingresa un entero entre 0 y 10.000.`);
    return [d,qty];
  }));
}

export function compareRuns(a,b,objective='principal'){
  const keys=objective==='volume'?['volumeM3','piecesA']:['piecesA','volumeM3'];
  for(const key of keys){
    const delta=b.totals[key]-a.totals[key];
    if(Math.abs(delta)>1e-9)return delta;
  }
  return 0;
}

// The cache belongs to one search, so no geometry survives a configuration change.
// Only aggregates are retained. The underlying V2 diameter search is unchanged.
export function planRun({config={},lot={},objective='principal'}={},onProgress=()=>{}){
  if(!['principal','volume'].includes(objective))throw new Error('Selecciona un objetivo válido para la corrida.');
  const normalized=normalizeConfig(config),stock=normalizeLot(lot);
  const diameters=DIAMETERS.filter(d=>stock[d]>0);
  if(!diameters.length)throw new Error('Ingresa al menos un trozo para planificar la corrida.');
  const cache=new Map(),base=normalized.cutting;
  let completed=0,evaluations=0;
  const centers=['60','75',...(base.x1===22?['y1']:[]),...(base.cm==='otro'?['otro']:[])];
  const total=32+4*centers.length;
  const evaluate=cutting=>{
    const rows=diameters.map(diameterCm=>{
      const key=JSON.stringify([cutting.med,cutting.m,cutting.e1,cutting.cm,cutting.e2,diameterCm]);
      let values=cache.get(key);
      if(!values){
        const r=compute({...cutting,d:diameterCm,length:normalized.length});
        values={principalPerLog:r.nPrin,piecesB:r.nApr,piecesC:r.nApr2,classificationPieces:r.nClas,
          edgerPieces:r.cant.reduce((sum,board)=>sum+board.plan.length,0),volumePerLog:r.vProd,referencePerLog:r.vJAS};
        cache.set(key,values);evaluations++;
      }
      const qty=stock[diameterCm];
      return {diameterCm,qty,...values,piecesA:qty*values.principalPerLog,
        piecesB:qty*values.piecesB,piecesC:qty*values.piecesC,
        classificationPieces:qty*values.classificationPieces,edgerPieces:qty*values.edgerPieces,
        volumeM3:qty*values.volumePerLog,referenceVolumeM3:qty*values.referencePerLog,
        yieldPercent:100*values.volumePerLog/values.referencePerLog};
    });
    const totals={logs:0,piecesA:0,piecesB:0,piecesC:0,classificationPieces:0,edgerPieces:0,volumeM3:0,referenceVolumeM3:0};
    for(const row of rows){
      totals.logs+=row.qty;
      for(const key of Object.keys(totals).filter(key=>key!=='logs'))totals[key]+=row[key];
    }
    totals.yieldPercent=100*totals.volumeM3/totals.referenceVolumeM3;
    return {config:{cutting:{...cutting},length:normalized.length},rows,totals};
  };
  const candidates=[];
  const add=cutting=>{
    candidates.push(evaluate(cutting));completed++;
    onProgress({completed,total});
  };
  // Keep the current pith setting first on exact ties, like suggestM's ascending m.
  for(const med of [base.med,!base.med])for(let m=0;m<=20;m+=med?2:1)add({...base,med,m});
  candidates.sort((a,b)=>compareRuns(a,b,objective));
  const winner=candidates[0].config.cutting;
  for(const e1 of [60,75])for(const e2 of [60,75])for(const cm of centers)add({...winner,e1,e2,cm});
  candidates.sort((a,b)=>compareRuns(a,b,objective));
  // Prefer different multiple assemblies; edger-only variants are a fallback.
  const seen=new Set(),assemblies=new Set(),distinct=[],fallback=[];
  for(const candidate of candidates){
    const p=candidate.config.cutting,key=JSON.stringify([p.med,p.m,p.e1,p.cm,p.e2]);
    if(seen.has(key))continue;
    seen.add(key);
    const assembly=JSON.stringify([p.med,p.m]);
    if(assemblies.has(assembly))fallback.push(candidate);
    else {assemblies.add(assembly);distinct.push(candidate);}
  }
  const ranked=[...distinct,...fallback].slice(0,3);
  return {objective,candidates:ranked,current:evaluate(base),evaluations};
}
