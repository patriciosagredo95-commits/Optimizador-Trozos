import test from 'node:test';
import assert from 'node:assert/strict';
import {candidateToSidebar} from '../dist/armado.js';
import {planRun,normalizeLot} from '../dist/run-planner.js';
import {normalizeConfig} from '../dist/optimizer.js';
import {configurationFile,parseConfiguration} from '../dist/reports.js';

test('Usar este armado conserva todos los campos de múltiple, canteadora y escuadrías',()=>{
  const config={cutting:{x1:22,x2:22,x3:22,y1:100,a:22,c:3,cm:'otro',cw:90},length:6000};
  const candidate=planRun({config,lot:{42:2}}).candidates[0];
  const before=structuredClone(candidate);
  const sidebar=candidateToSidebar(candidate);
  assert.deepEqual(sidebar,normalizeConfig(candidate.config));
  for(const key of ['med','m','a','c','e1','cm','e2','cw','x1','y1','x2','y2','x3','y3','referenceDiameter'])assert.equal(sidebar.cutting[key],candidate.config.cutting[key]);
  assert.equal(sidebar.length,6000);
  assert.deepEqual(candidate,before);
  sidebar.cutting.m=40;
  assert.deepEqual(candidate,before);
});

test('JSON del formulario restaurado preserva lote y prioridad sin requerir modo',()=>{
  const config={...normalizeConfig(),lot:normalizeLot({30:4,42:12}),objective:'volume'};
  assert.deepEqual(parseConfiguration(configurationFile(config)),config);
});
