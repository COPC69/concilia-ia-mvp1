const { normalizeText } = require('./fileReader');

const FIELD_PATTERNS = {
  date: ['fecha', 'fecha movimiento', 'fec', 'f movimiento', 'fecha transaccion'],
  description: ['descripcion', 'descripción', 'detalle', 'concepto', 'tercero', 'beneficiario', 'observacion', 'observación', 'nombre', 'razon social'],
  amount: ['valor', 'importe', 'monto', 'total', 'movimiento'],
  debit: ['debito', 'débito', 'debitos', 'débitos', 'abono', 'abonos', 'entrada', 'entradas', 'ingreso', 'ingresos'],
  credit: ['credito', 'crédito', 'creditos', 'créditos', 'cargo', 'cargos', 'salida', 'salidas', 'egreso', 'egresos'],
  balance: ['saldo', 'nuevo saldo', 'saldo final'],
  reference: ['documento', 'comprobante', 'referencia', 'numero', 'número', 'doc', 'id', 'consecutivo']
};

function scoreHeader(header, patterns) {
  const h = normalizeText(header);
  let score = 0;
  for (const p of patterns) {
    const np = normalizeText(p);
    if (h === np) score += 10;
    else if (h.includes(np)) score += 6;
    else if (np.includes(h) && h.length >= 4) score += 3;
  }
  return score;
}

function inferColumns(headers, role) {
  const mapping = {};
  const used = new Set();

  for (const [field, patterns] of Object.entries(FIELD_PATTERNS)) {
    let best = { header: null, score: 0 };
    for (const h of headers) {
      if (used.has(h)) continue;
      const score = scoreHeader(h, patterns);
      if (score > best.score) best = { header: h, score };
    }
    if (best.score >= 5) {
      mapping[field] = best.header;
      used.add(best.header);
    }
  }

  // Para extractos bancarios, si hay una sola columna Valor, se usa amount.
  // Para archivos contables tipo CONTAI, preferimos Débitos/Créditos si existen.
  if (role === 'internal' && mapping.debit && mapping.credit) {
    delete mapping.amount;
  }

  return mapping;
}

module.exports = { inferColumns };
