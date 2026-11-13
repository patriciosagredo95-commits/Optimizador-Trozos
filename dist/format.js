// Formato de pantalla: un decimal; etiquetas compactas de gráficos y chips sin decimales.
const percentages = [0, 1].map(digits => new Intl.NumberFormat('es-CL', {minimumFractionDigits: digits, maximumFractionDigits: digits}));
export const formatPercent = (value, compact = false) => percentages[compact ? 0 : 1].format(value) + ' %';
