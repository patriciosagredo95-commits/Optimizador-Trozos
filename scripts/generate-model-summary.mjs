import {writeFileSync} from 'node:fs';
import {CUTTING_DEFAULTS,DIAMETERS,KC,KM,armMain,createOptimizer} from '../dist/optimizer.js';
import {cuttingScheme} from '../dist/reports.js';

const engine=createOptimizer(),p=CUTTING_DEFAULTS,arm=armMain(p);
const rows=DIAMETERS.map(d=>{
  const result=engine.solve(d),r=result.cutting;
  return `| ${d} | ${cuttingScheme(result)} | ${r.nPrin} | ${r.nApr} | ${r.nApr2} | ${r.nClas} (${r.nLost}) | ${r.nCant} | ${r.vProd.toFixed(4)} / ${r.vJAS.toFixed(4)} | ${(r.yield*100).toFixed(2)} % |`;
});
const summary=`# Resumen del modelo de corte

## Método general V2

Todos los diámetros del catálogo usan el mismo armado y formato de producción. Se prioriza la cantidad de principales sanas y luego el rendimiento JAS. El armado permanece fijo durante la corrida.

## Entradas

Principal X1 × Y1 de ${p.x1} × ${p.y1} mm. Primer aprovechamiento X2 × Y2 de ${p.x2} × ${p.y2} mm. Segundo aprovechamiento X3 × Y3 de ${p.x3} × ${p.y3} mm. Y2 o Y3 igual a cero desactiva ese ancho. Las semibasas pasan por la múltiple y sus piezas tienen espesor X1. X2/X3 determinan la presentación m o N cuando los espesores son iguales.

Dos tablas de 22 mm en cada extremo. Médula encerrada por defecto, c = ${p.c}, a = ${p.a} mm y m = ${p.m}. Total de ${arm.seq.length} posiciones y ancho ${arm.X.toFixed(1)} mm. Con espesores iguales se ingresa N, incluyendo los cuatro extremos y las c tablas centrales. La sugerencia explora m de 0 a 20, con referencia configurable entre 16 y 56 cm, por defecto ${p.referenceDiameter} cm.

Canteadora e1 = ${p.e1} mm y e2 = ${p.e2} mm. Centro ${p.cm} mm por defecto, configurable a 60, 75, Y1 si X1 = 22 u otro ancho. Kerf fijo de carro y huinchas ${KC} mm y de múltiple y canteadora ${KM} mm. Largo por defecto 4000 mm, configurable entre 500 y 12000 mm.

## Geometría y selección

El umbral interno de 36 cm selecciona la geometría del carro. Por debajo se barre F desde F1 hasta F3 exclusivo cada 2 mm para obtener una o dos tablas del lampazo. Huinchas empieza por Y1 y repite el primer ancho aceptable entre Y1, Y2 y Y3, en orientación yu. Se reaserran los lampazos de carro y huinchas.

Desde el umbral se prueban recortes simétricos j del armado, tres caras de carro, grupo Y1 centrado y luego aprovechamientos Y2/Y3. Se ofrecen los dos mejores candidatos con F o j distinto cuando existen.

Las tablas de 22 mm con pérdida hasta 10 % van a clasificación, entre 10 % y 25 % a canteadora y por encima a descarte. Los aprovechamientos aceptan pérdida hasta 10 %. La canteadora prueba extremo–centro–extremo, ambos extremos y luego la pieza más ancha que quepa. Las tablas centrales se incluyen en producción. Se preservan las reglas del script del prototipo.

## Volúmenes, salidas y comparación

V_JAS = D_cm² × largo_mm / 10⁷. V_prod = área de producción_mm² × largo_mm / 10⁹. Rendimiento = 100 × V_prod / V_JAS.

Indicadores, lista de piezas con destino, avisos y vistas de Carro, Huinchas, Múltiple y Canteadora usan las clases de colores V2 y kerf rojo. CSV y ficha imprimible contienen producción y cotas por máquina.

El pedido usa todos los trozos con patrón disponible, suma principal, aprovechamientos 1 y 2 y otras piezas y pondera el rendimiento por volumen JAS. La comparación histórica se conserva con cantidades del catálogo físico del resultado seleccionado, con las mismas condiciones y validación de planta declarada por el usuario.

La persistencia usa glover-cutting-config-v3. La migración de v2 conserva únicamente largo y entradas V2. Los parámetros del motor anterior se ignoran.

## Resultados con entradas por defecto

| Ø cm | Esquema | Principal | Aprov. 1 | Aprov. 2 | 22 a clas. (descartadas totales) | Cant. | V_prod / V_JAS m³ | Rend. |
|---|---|---|---|---|---|---|---|---|
${rows.join('\n')}
`;
writeFileSync(new URL('../Resumen Modelo.md',import.meta.url),summary);
