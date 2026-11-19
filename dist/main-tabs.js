import {initAnalysis} from './analysis-view.js';
const tabs=[...document.querySelectorAll('.main-tabs [role=tab]')];
let activateAnalysis;
function select(name,focus=false){
 document.body.classList.toggle('monitor-mode',name==='monitor');if(name==='monitor')name='analisis';
 if(!['analisis','planificacion'].includes(name))name='planificacion';
 tabs.forEach(t=>{const active=t.dataset.main===name;t.setAttribute('aria-selected',String(active));t.tabIndex=active?0:-1;document.getElementById(t.getAttribute('aria-controls')).hidden=!active;if(active&&focus)t.focus();});
 try{localStorage.setItem('glover-main-tab',name);}catch{}
 if(name==='analisis'){activateAnalysis??=initAnalysis(document.getElementById('analysis-panel'));activateAnalysis(true);}else activateAnalysis?.(false);
}
tabs.forEach((t,i)=>{t.onclick=()=>{history.replaceState(null,'',`#${t.dataset.main}`);select(t.dataset.main);};t.onkeydown=e=>{if(['ArrowLeft','ArrowRight','Home','End'].includes(e.key)){e.preventDefault();const j=e.key==='Home'?0:e.key==='End'?tabs.length-1:(i+(e.key==='ArrowRight'?1:-1)+tabs.length)%tabs.length;tabs[j].click();tabs[j].focus();}};});
let saved;try{saved=localStorage.getItem('glover-main-tab');}catch{}
select(['monitor','analisis','planificacion'].includes(location.hash.slice(1))?location.hash.slice(1):saved);
addEventListener('hashchange',()=>select(location.hash.slice(1)));
