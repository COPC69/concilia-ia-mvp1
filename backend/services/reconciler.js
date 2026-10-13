const { normalizeText } = require('./fileReader');
const { daysBetween } = require('./normalizer');

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function signedValue(m) {
  return m.type === 'ingreso' ? m.value : -m.value;
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

function buildMatch(bank, internal, status, score, amountTolerance, extra = {}) {
  const amountDiff = round2((bank?.value || 0) - (internal?.value || 0));
  const dateDiff = bank?.date && internal?.date ? daysBetween(bank.date, internal.date) : '—';
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
        : 'Diferencia de valor por revisar',
    ...extra
  };
}

function computeDiagnostics(bank, internal = null) {
  const bankIngresos = bank.movements.filter(m => m.type === 'ingreso').reduce((a, m) => a + m.value, 0);
  const bankEgresos = bank.movements.filter(m => m.type === 'egreso').reduce((a, m) => a + m.value, 0);
  const bankExpenses = bank.movements.filter(m => m.isBankExpense);
  const bankExpensesIngresos = bankExpenses.filter(m => m.type === 'ingreso').reduce((a, m) => a + m.value, 0);
  const bankExpensesEgresos = bankExpenses.filter(m => m.type === 'egreso').reduce((a, m) => a + m.value, 0);

  const diagnostics = {
    totalIngresosBanco: round2(bankIngresos),
    totalEgresosBanco: round2(bankEgresos),
    totalNetoBanco: round2(bankIngresos - bankEgresos),
    gastosBancariosIngresosBanco: round2(bankExpensesIngresos),
    gastosBancariosEgresosBanco: round2(bankExpensesEgresos),
    gastosBancariosNetoBanco: round2(bankExpensesIngresos - bankExpensesEgresos)
  };

  if (internal) {
    const internalIngresos = internal.movements.filter(m => m.type === 'ingreso').reduce((a, m) => a + m.value, 0);
    const internalEgresos = internal.movements.filter(m => m.type === 'egreso').reduce((a, m) => a + m.value, 0);
    diagnostics.totalIngresosInterno = round2(internalIngresos);
    diagnostics.totalEgresosInterno = round2(internalEgresos);
    diagnostics.totalNetoInterno = round2(internalIngresos - internalEgresos);
    diagnostics.diferenciaNeta = round2(diagnostics.totalNetoBanco - diagnostics.totalNetoInterno);
  }

  return diagnostics;
}

function looksLikeBankAggregate(internalMovement) {
  const d = normalizeText(internalMovement.description || '');
  return (
    d.includes('bancolombia') ||
    d.includes('banco') ||
    d.includes('gasto bancario') ||
    d.includes('gastos bancarios') ||
    d.includes('comision') ||
    d.includes('4x1000') ||
    d.includes('gmf')
  );
}

function tryGroupedBankExpenseMatch({ bank, internal, usedBank, usedInternal, opts }) {
  const availableExpenses = bank.movements.filter(m => !usedBank.has(m.id) && m.isBankExpense);
  if (!availableExpenses.length || !internal) return null;

  const candidates = internal.movements.filter(m => !usedInternal.has(m.id) && looksLikeBankAggregate(m));
  if (!candidates.length) return null;

  const net = round2(availableExpenses.reduce((a, m) => a + signedValue(m), 0));
  const absNet = Math.abs(net);
  if (absNet === 0) return null;

  let best = null;
  for (const i of candidates) {
    const signedInternal = signedValue(i);
    const diff = round2(net - signedInternal);
    const tolerance = Math.max(opts.amountTolerance, 5);
    const score = Math.max(0, 100 - Math.round(Math.abs(diff) / Math.max(1, absNet) * 100));
    if (Math.abs(diff) <= tolerance || score >= 98) {
      if (!best || Math.abs(diff) < Math.abs(best.diff)) best = { internal: i, diff, score };
    }
  }

  if (!best) return null;

  const pseudoBank = {
    id: 'BANK-GROUP-EXPENSES',
    source: 'bank',
    rowNumber: 'agrupado',
    date: best.internal.date,
    description: `${availableExpenses.length} gastos bancarios agrupados`,
    reference: 'Agrupación automática',
    value: absNet,
    type: net >= 0 ? 'ingreso' : 'egreso',
    balance: null,
    isBankExpense: true,
    original: null
  };

  return buildMatch(pseudoBank, best.internal, 'gastos_bancarios_agrupados', best.score, Math.max(opts.amountTolerance, 5), {
    amountDiff: best.diff,
    dateDiff: '—',
    note: `Agrupa ${availableExpenses.length} movimientos bancarios propios de la cuenta.`,
    bankGroupCount: availableExpenses.length,
    bankGroupIds: availableExpenses.map(m => m.id),
    bankGroupNet: net
  });
}

function reconcile({ bank, internal, options }) {
  const opts = {
    amountTolerance: Number(options?.amountTolerance ?? 2),
    daysWindow: Number(options?.daysWindow ?? 3),
    minProbableScore: Number(options?.minProbableScore ?? 72)
  };

  const diagnostics = computeDiagnostics(bank, internal);
  const allBankExpenses = bank.movements.filter(m => m.isBankExpense);

  if (!internal) {
    const ingresos = bank.movements.filter(m => m.type === 'ingreso');
    const egresos = bank.movements.filter(m => m.type === 'egreso');
    return {
      summary: {
        mode: 'analisis_extracto',
        bankMovements: bank.movements.length,
        internalMovements: 0,
        bankExpenses: allBankExpenses.length,
        totalIngresosBanco: round2(ingresos.reduce((a, m) => a + m.value, 0)),
        totalEgresosBanco: round2(egresos.reduce((a, m) => a + m.value, 0)),
        ...diagnostics
      },
      diagnostics,
      matches: [],
      probable: [],
      bankOnly: bank.movements.map(m => ({ status: m.isBankExpense ? 'gasto_bancario_detectado' : 'movimiento_sin_clasificar', bank: m })),
      internalOnly: [],
      bankExpenses: allBankExpenses.map(m => ({ status: 'gasto_bancario_detectado', bank: m }))
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

  // 2. Coincidencias probables por valor, fecha cercana y texto.
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

  // 3. Conciliación agrupada de gastos bancarios, útil cuando CONTAI resume 4x1000,
  // comisiones e intereses en un solo registro contable.
  const groupedBankExpenses = [];
  const grouped = tryGroupedBankExpenseMatch({ bank, internal, usedBank, usedInternal, opts });
  if (grouped) {
    groupedBankExpenses.push(grouped);
    matches.push(grouped);
    for (const id of grouped.bankGroupIds || []) usedBank.add(id);
    if (grouped.internal?.id) usedInternal.add(grouped.internal.id);
  }

  const bankOnly = bank.movements
    .filter(m => !usedBank.has(m.id))
    .map(m => ({ status: m.isBankExpense ? 'gasto_bancario_detectado' : 'banco_sin_registro_interno', bank: m }));

  const internalOnly = internal.movements
    .filter(m => !usedInternal.has(m.id))
    .map(m => ({ status: 'registro_interno_sin_banco', internal: m }));

  const matchedBankCount = usedBank.size;
  const matchedInternalCount = usedInternal.size;

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
      gastosBancariosDetectados: allBankExpenses.length,
      gastosBancariosAgrupados: groupedBankExpenses.length,
      totalNetoBanco: diagnostics.totalNetoBanco,
      totalNetoInterno: diagnostics.totalNetoInterno,
      diferenciaNeta: diagnostics.diferenciaNeta,
      porcentajeBancoConciliado: bank.movements.length ? Math.round((matchedBankCount / bank.movements.length) * 100) : 0,
      porcentajeInternoConciliado: internal.movements.length ? Math.round((matchedInternalCount / internal.movements.length) * 100) : 0,
      totalIngresosBanco: diagnostics.totalIngresosBanco,
      totalEgresosBanco: diagnostics.totalEgresosBanco,
      totalIngresosInterno: diagnostics.totalIngresosInterno,
      totalEgresosInterno: diagnostics.totalEgresosInterno,
      gastosBancariosNetoBanco: diagnostics.gastosBancariosNetoBanco
    },
    diagnostics,
    matches,
    probable,
    bankOnly,
    internalOnly,
    bankExpenses: allBankExpenses.map(m => ({ status: usedBank.has(m.id) ? 'gasto_bancario_agrupado_o_conciliado' : 'gasto_bancario_detectado', bank: m })),
    groupedBankExpenses
  };
}

module.exports = { reconcile, textSimilarity };
