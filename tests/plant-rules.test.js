import test from 'node:test';
import assert from 'node:assert/strict';
import {compute,CUTTING_DEFAULTS} from '../dist/optimizer.js';

// Regla confirmada por planta el 2026-11-09: con principal 22 × 75, las piezas de 75 mm
// que salen de la canteadora (centro o extremos) son medida principal.
const base={...CUTTING_DEFAULTS,y2:0,y3:0,med:false,m:6,e1:75,e2:60,cm:'60',d:30};

test('principal 22 × 75: las piezas de 75 de canteadora cuentan como medida principal',()=>{
  const r=compute({...base,x1:22,y1:75,x2:22,x3:22});
  const pieces=r.cant.flatMap(board=>board.plan);
  const of75=pieces.filter(piece=>piece.w===75);
  assert.ok(of75.length>0,'el caso debe tener piezas de 75 en canteadora');
  assert.ok(of75.every(piece=>piece.k==='prin'));
  assert.ok(pieces.filter(piece=>piece.w!==75).every(piece=>piece.k==='clas'));
  assert.equal(r.nPrinCant,of75.length);
});

test('con otro espesor principal las piezas de canteadora siguen yendo a clasificación',()=>{
  const r=compute({...base,x1:50,y1:75,x2:50,x3:50});
  assert.ok(r.cant.flatMap(board=>board.plan).every(piece=>piece.k==='clas'));
  assert.equal(r.nPrinCant,0);
});
