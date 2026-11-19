import {DIAMETERS} from './optimizer.js';

const MAX_LOGS_PER_DIAMETER=10000;
// Misma prioridad lexicográfica para la vista, la exportación y el pedido.
// Objetivo por defecto (2026-11-19): mayor rendimiento total y, a igual rendimiento, más piezas principales.
// 'principal' conserva el criterio validado anterior (principal sana y después rendimiento JAS).
export function bestYieldAlternative(result,objetivo='rendimiento'){
  const alternatives=result?.alternatives?.length?result.alternatives:result?.status==='found'?[result]:[];
  return alternatives.reduce((winner,pattern,index)=>{
    if(pattern.status!=='found'||!Number.isFinite(pattern.volume)||!(pattern.referenceVolume>0))return winner;
    const principal=pattern.cutting.nPrin,yieldPercent=100*pattern.volume/pattern.referenceVolume;
    const mejor=!winner||(objetivo==='principal'
      ?principal>winner.pattern.cutting.nPrin||(principal===winner.pattern.cutting.nPrin&&yieldPercent>winner.yieldPercent+1e-7)
      :yieldPercent>winner.yieldPercent+1e-7||(Math.abs(yieldPercent-winner.yieldPercent)<=1e-7&&principal>winner.pattern.cutting.nPrin));
    if(mejor){
      return {pattern,alternative:index+1,yieldPercent};
    }
    return winner;
  },null);
}

function logCount(value,diameter){
  const number=Number(value===''||value==null?0:value);
  if(!Number.isSafeInteger(number)||number<0||number>MAX_LOGS_PER_DIAMETER){
    throw new Error(`Trozos de ${diameter} cm: ingresa un entero entre 0 y ${MAX_LOGS_PER_DIAMETER.toLocaleString('es-CL')}.`);
  }
  return number;
}

// El stock fija el número de trozos. Cada diámetro se optimiza de forma independiente
// usando el mayor rendimiento total (a igual rendimiento, más principal).
export function simulateOrder(resultsByDiameter,stockByDiameter){
  const rows=DIAMETERS.map(diameterCm=>{
    const availableLogs=logCount(stockByDiameter instanceof Map?stockByDiameter.get(diameterCm):stockByDiameter?.[diameterCm],diameterCm);
    const best=bestYieldAlternative(resultsByDiameter.get(diameterCm));
    const usedLogs=best?availableLogs:0,pattern=best?.pattern;
    const volumeM3=usedLogs*(pattern?.volume??0);
    const referenceVolumeM3=usedLogs*(pattern?.referenceVolume??0);
    return {diameterCm,availableLogs,usedLogs,unusedLogs:availableLogs-usedLogs,
      alternative:usedLogs?best.alternative:null,
      piecesA:usedLogs*(pattern?.counts?.[0]?.quantity??0),
      piecesB:usedLogs*(pattern?.cutting.nApr??0),
      piecesC:usedLogs*(pattern?.cutting.nApr2??0),
      recoveryPieces:usedLogs*(pattern?.recoveryCount??0),
      volumeM3,referenceVolumeM3,yieldPercent:usedLogs?100*volumeM3/referenceVolumeM3:null,
      status:availableLogs&&!best?'no_pattern':usedLogs?'used':'no_stock'};
  });
  const totals=rows.reduce((sum,row)=>({
    availableLogs:sum.availableLogs+row.availableLogs,usedLogs:sum.usedLogs+row.usedLogs,
    piecesA:sum.piecesA+row.piecesA,piecesB:sum.piecesB+row.piecesB,piecesC:sum.piecesC+row.piecesC,
    recoveryPieces:sum.recoveryPieces+row.recoveryPieces,
    volumeM3:sum.volumeM3+row.volumeM3,referenceVolumeM3:sum.referenceVolumeM3+row.referenceVolumeM3
  }),{availableLogs:0,usedLogs:0,piecesA:0,piecesB:0,piecesC:0,recoveryPieces:0,volumeM3:0,referenceVolumeM3:0});
  totals.unusedLogs=totals.availableLogs-totals.usedLogs;
  totals.yieldPercent=totals.referenceVolumeM3?100*totals.volumeM3/totals.referenceVolumeM3:null;
  return {labels:{piecesA:'Principal',piecesB:'Aprovechamiento 1',piecesC:'Aprovechamiento 2'},rows,totals};
}
