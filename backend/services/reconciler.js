const { normalizeText } = require('./fileReader');
const { daysBetween } = require('./normalizer');

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function tokenSet(text) {
  const stop = new Set(['de','del','la','el','los','las','a','por','para','con','y','en','pago','transferencia','transf','terceros','bancolombia']);
  return new Set(normalizeText(text)
    .replace(/[^a-z0-9ñ\s]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length >= 3 && !stop.has(t)));
}

function textSimilarity(a, b) {
  const A = tokenSet(a);
  const B = tokenSet(b);
  if (A.size === 0 || B.size === 0) return 0;
  let intersection = 0;
  for (const t of A) if (B.has(t)) intersection += 1;
  const union = new Set([...A, ...B]).size;
  return union ? intersection / union : 0;
}

function scorePair(bank, internal, options) {
  if (bank.type !== internal.type) return -1;
  const amountDiff = Math.abs(bank.value - internal.value);
  const dateDiff = daysBetween(bank.date, internal.date);
  const sim = textSimilarity(bank.description, internal.description);

  let score = 0;
  if (amountDiff <= options.amountTolerance) score += 55;
  else if (amountDiff <= Math.max(1000, internal.value * 0.002)) score += 32;
  else return -1;

  if (dateDiff === 0) score += 30;
  else if (dateDiff <= 1) score += 25;
  else if (dateDiff <= options.daysWindow) score += 18;
  else if (sim >= 0.35) score += 8;
  else return -1;

  score += Math.round(sim * 15);
  return Math.min(100, score);
}

function buildMatch(bank, internal, status, score, amountTolerance) {
  const amountDiff = round2(bank.value - internal.value);
  const dateDiff = daysBetween(bank.date, internal.date);
  return {
    status,
    score,
    bank,
    internal,
    amountDiff,
    dateDiff,
    note: amountDiff === 0
      ? 'Valor exacto'
      : Math.abs(amountDiff) <= amountTolerance
        ? 'Diferencia menor dentro de tolerancia'
        : 'Diferencia de valor por revisar'
  };
}

function reconcile({ bank, internal, options }) {
  const opts = {
    amountTolerance: Number(options?.amountTolerance ?? 2),
    daysWindow: Number(options?.daysWindow ?? 3),
    minProbableScore: Number(options?.minProbableScore ?? 72)
  };

  if (!internal) {
    const bankExpenses = bank.movements.filter(m => m.isBankExpense);
    const ingresos = bank.movements.filter(m => m.type === 'ingreso');
    const egresos = bank.movements.filter(m => m.type === 'egreso');
    return {
      summary: {
        mode: 'analisis_extracto',
        bankMovements: bank.movements.length,
        internalMovements: 0,
        bankExpenses: bankExpenses.length,
        totalIngresosBanco: round2(ingresos.reduce((a, m) => a + m.value, 0)),
        totalEgresosBanco: round2(egresos.reduce((a, m) => a + m.value, 0))
      },
      matches: [],
      probable: [],
      bankOnly: bank.movements.map(m => ({ status: m.isBankExpense ? 'gasto_bancario_detectado' : 'movimiento_sin_clasificar', bank: m })),
      internalOnly: [],
      bankExpenses: bankExpenses.map(m => ({ status: 'gasto_bancario_detectado', bank: m }))
    };
  }

  const usedBank = new Set();
  const usedInternal = new Set();
  const matches = [];
  const probable = [];

  // 1. Coincidencias exactas o con tolerancia mínima en misma fecha.
  for (const b of bank.movements) {
    for (const i of internal.movements) {
      if (usedBank.has(b.id) || usedInternal.has(i.id)) continue;
      if (b.type !== i.type) continue;
      const amountDiff = Math.abs(b.value - i.value);
      const dateDiff = daysBetween(b.date, i.date);
      if (amountDiff <= opts.amountTolerance && dateDiff === 0) {
        const status = amountDiff === 0 ? 'conciliado_exacto' : 'conciliado_diferencia_menor';
        matches.push(buildMatch(b, i, status, 100, opts.amountTolerance));
        usedBank.add(b.id);
        usedInternal.add(i.id);
      }
    }
  }

  // 2. Coincidencias probables por valor y fecha cercana.
  const candidates = [];
  for (const b of bank.movements) {
    if (usedBank.has(b.id)) continue;
    for (const i of internal.movements) {
      if (usedInternal.has(i.id)) continue;
      const score = scorePair(b, i, opts);
      if (score >= opts.minProbableScore) candidates.push({ b, i, score });
    }
  }

  candidates.sort((a, b) => b.score - a.score);
  for (const c of candidates) {
    if (usedBank.has(c.b.id) || usedInternal.has(c.i.id)) continue;
    const amountDiff = Math.abs(c.b.value - c.i.value);
    const status = amountDiff <= opts.amountTolerance ? 'coincidencia_probable' : 'diferencia_valor_probable';
    probable.push(buildMatch(c.b, c.i, status, c.score, opts.amountTolerance));
    usedBank.add(c.b.id);
    usedInternal.add(c.i.id);
  }

  const bankOnly = bank.movements
    .filter(m => !usedBank.has(m.id))
    .map(m => ({ status: m.isBankExpense ? 'gasto_bancario_detectado' : 'banco_sin_registro_interno', bank: m }));

  const internalOnly = internal.movements
    .filter(m => !usedInternal.has(m.id))
    .map(m => ({ status: 'registro_interno_sin_banco', internal: m }));

  const bankExpenses = bankOnly.filter(x => x.status === 'gasto_bancario_detectado');

  const allBankMatched = matches.length + probable.length;
  const allInternalMatched = matches.length + probable.length;
  const totalBanco = round2(bank.movements.reduce((a, m) => a + (m.type === 'ingreso' ? m.value : -m.value), 0));
  const totalInterno = round2(internal.movements.reduce((a, m) => a + (m.type === 'ingreso' ? m.value : -m.value), 0));

  return {
    summary: {
      mode: 'conciliacion_completa',
      bankMovements: bank.movements.length,
      internalMovements: internal.movements.length,
      conciliadosExactos: matches.filter(m => m.status === 'conciliado_exacto').length,
      conciliadosDiferenciaMenor: matches.filter(m => m.status === 'conciliado_diferencia_menor').length,
      coincidenciasProbables: probable.length,
      bancoSinRegistroInterno: bankOnly.filter(x => x.status === 'banco_sin_registro_interno').length,
      registroInternoSinBanco: internalOnly.length,
      gastosBancariosDetectados: bankExpenses.length,
      totalNetoBanco: totalBanco,
      totalNetoInterno: totalInterno,
      diferenciaNeta: round2(totalBanco - totalInterno),
      porcentajeBancoConciliado: bank.movements.length ? Math.round((allBankMatched / bank.movements.length) * 100) : 0,
      porcentajeInternoConciliado: internal.movements.length ? Math.round((allInternalMatched / internal.movements.length) * 100) : 0
    },
    matches,
    probable,
    bankOnly,
    internalOnly,
    bankExpenses
  };
}

module.exports = { reconcile, textSimilarity };
