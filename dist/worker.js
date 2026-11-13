import {createOptimizer,DIAMETERS} from './optimizer.js';
import {planRun} from './run-planner.js';
self.onmessage=event=>{
  const {runId,config}=event.data;
  try{
    if(event.data.type==='plan-run'){
      const plan=planRun(event.data,progress=>self.postMessage({type:'plan-progress',runId,...progress}));
      self.postMessage({type:'plan-done',runId,plan});
      return;
    }
    const optimizer=createOptimizer(config);
    self.postMessage({type:'ready',runId,config:optimizer.config});
    const order=[42,...DIAMETERS.filter(d=>d!==42)];
    for(let i=0;i<order.length;i++){
      const result=optimizer.solve(order[i]);
      self.postMessage({type:'result',runId,result,completed:i+1,total:DIAMETERS.length});
    }
    self.postMessage({type:'done',runId});
  }catch(error){self.postMessage({type:'error',runId,message:error.message||'No se pudo completar el cálculo.'});}
};
