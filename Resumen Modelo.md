# Resumen del modelo de corte

## Método general V2

Todos los diámetros del catálogo usan el mismo armado y formato de producción. Todos los trozos buscan el mayor rendimiento total (volumen producido / volumen JAS); a igual rendimiento, más piezas de medida principal. El armado permanece fijo durante la corrida.

## Entradas

Principal X1 × Y1 de 50 × 100 mm. Primer aprovechamiento X2 × Y2 de 38 × 75 mm. Segundo aprovechamiento X3 × Y3 de 25 × 50 mm. Y2 o Y3 igual a cero desactiva ese ancho. Las semibasas pasan por la múltiple y sus piezas tienen espesor X1. X2/X3 determinan la presentación m o N cuando los espesores son iguales.

Dos tablas de 22 mm en cada extremo. Médula encerrada por defecto, c = 2, a = 26 mm y m = 2. Total de 8 posiciones y ancho 269.4 mm. Con espesores iguales se ingresa N, incluyendo los cuatro extremos y las c tablas centrales. La sugerencia explora m de 0 a 20, con referencia configurable entre 16 y 56 cm, por defecto 42 cm.

Canteadora e1 = 60 mm y e2 = 75 mm. Centro 75 mm por defecto, configurable a 60, 75, Y1 si X1 = 22 u otro ancho. Kerf fijo de carro y huinchas 3.4 mm y de múltiple y canteadora 4.2 mm. Largo por defecto 4000 mm, configurable entre 500 y 12000 mm.

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
| 16 | Cara plana del carro · 1 basa principal | 0 | 0 | 0 | 0 (0) | 1 | 0.0274 / 0.1024 | 26.76 % |
| 18 | Cara plana del carro · 1 basa principal | 0 | 0 | 0 | 0 (0) | 4 | 0.0393 / 0.1296 | 30.31 % |
| 20 | Cara plana del carro · 1 basa principal | 2 | 0 | 0 | 0 (0) | 5 | 0.0846 / 0.1600 | 52.85 % |
| 22 | Cara plana del carro · 1 basa principal | 2 | 0 | 0 | 0 (0) | 6 | 0.0978 / 0.1936 | 50.50 % |
| 24 | Cara plana del carro · 1 basa principal · 1 semibasa de segundo aprovechamiento | 2 | 0 | 2 | 0 (0) | 10 | 0.1229 / 0.2304 | 53.33 % |
| 26 | Cara plana del carro · 1 basa principal · 1 semibasa de primer aprovechamiento | 2 | 2 | 0 | 0 (0) | 10 | 0.1486 / 0.2704 | 54.97 % |
| 28 | Cara plana del carro · 1 basa principal · 1 semibasa de primer aprovechamiento | 2 | 2 | 0 | 2 (0) | 9 | 0.1702 / 0.3136 | 54.27 % |
| 30 | Cara plana del carro · 2 basas principales | 4 | 0 | 0 | 4 (0) | 6 | 0.2017 / 0.3600 | 56.02 % |
| 32 | Cara plana del carro · 2 basas principales | 4 | 0 | 0 | 6 (0) | 5 | 0.2272 / 0.4096 | 55.47 % |
| 34 | Cara plana del carro · 2 basas principales | 4 | 0 | 0 | 8 (0) | 4 | 0.2527 / 0.4624 | 54.65 % |
| 36 | Basa de 269,4 mm · 3 basas principales | 6 | 0 | 0 | 4 (0) | 10 | 0.2889 / 0.5184 | 55.73 % |
| 38 | Basa de 269,4 mm · 3 basas principales | 6 | 0 | 0 | 8 (0) | 10 | 0.3294 / 0.5776 | 57.02 % |
| 40 | Basa de 269,4 mm · 3 basas principales | 6 | 0 | 0 | 8 (0) | 10 | 0.3637 / 0.6400 | 56.83 % |
| 42 | Basa de 269,4 mm · 3 basas principales | 6 | 0 | 0 | 12 (0) | 8 | 0.3989 / 0.7056 | 56.53 % |
| 44 | Basa de 269,4 mm · 3 basas principales | 6 | 0 | 0 | 12 (0) | 10 | 0.4358 / 0.7744 | 56.28 % |
| 46 | Basa de 269,4 mm · 4 basas principales | 8 | 0 | 0 | 8 (0) | 14 | 0.4641 / 0.8464 | 54.83 % |
| 48 | Basa de 269,4 mm · 4 basas principales | 8 | 0 | 0 | 12 (0) | 14 | 0.5125 / 0.9216 | 55.61 % |
| 50 | Basa de 269,4 mm · 4 basas principales | 8 | 0 | 0 | 16 (0) | 10 | 0.5424 / 1.0000 | 54.24 % |
| 52 | Basa de 269,4 mm · 4 basas principales | 8 | 0 | 0 | 16 (0) | 12 | 0.5688 / 1.0816 | 52.59 % |
| 54 | Basa de 269,4 mm · 5 basas principales | 10 | 0 | 0 | 12 (0) | 18 | 0.6234 / 1.1664 | 53.45 % |
| 56 | Basa de 269,4 mm · 5 basas principales | 10 | 0 | 0 | 16 (0) | 14 | 0.6428 / 1.2544 | 51.24 % |
