import {theoreticalForDay} from './analysis.js';
import {planRun} from './run-planner.js';
self.onmessage=({data:{id,day}})=>{try{self.postMessage({id,result:theoreticalForDay(day,planRun)});}catch(e){self.postMessage({id,error:e.message});}};
