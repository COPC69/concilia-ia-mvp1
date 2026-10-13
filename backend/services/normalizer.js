const { inferColumns } = require('./columnMapper');
const { normalizeText } = require('./fileReader');

function parseNumber(value) {
  if (typeof value === 'number') return value;
  let s = String(value ?? '').trim();
  if (!s) return 0;

  s = s.replace(/\s/g, '');
  s = s.replace(/\$/g, '').replace(/COP/ig, '');

  const hasComma = s.includes(',');
  const hasDot = s.includes('.');

  if (hasComma && hasDot) {
    const lastComma = s.lastIndexOf(',');
    const lastDot = s.lastIndexOf('.');
    if (lastComma > lastDot) {
      s = s.replace(/\./g, '').replace(',', '.');
    } else {
      s = s.replace(/,/g, '');
    }
  } else if (hasComma && !hasDot) {
    const parts = s.split(',');
    if (parts[parts.length - 1].length <= 2) s = s.replace(',', '.');
    else s = s.replace(/,/g, '');
  } else if (hasDot && !hasComma) {
    const parts = s.split('.');
    if (parts.length > 2) s = s.replace(/\./g, '');
  }

  const n = Number(s.replace(/[^0-9.-]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

function parseDate(value, fallbackYear = null) {
  if (!value) return null;
  if (value instanceof Date && !isNaN(value)) return value.toISOString().slice(0, 10);

  const s = String(value).trim();
  if (!s) return null;

  // ISO o yyyy-mm-dd
  const iso = s.match(/(20\d{2}|19\d{2})[-/](\d{1,2})[-/](\d{1,2})/);
  if (iso) {
    const [, y, m, d] = iso;
    return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  }

  // dd/mm/yyyy o dd-mm-yyyy
  const latam = s.match(/(\d{1,2})[-/](\d{1,2})[-/](20\d{2}|19\d{2})/);
  if (latam) {
    const [, d, m, y] = latam;
    return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  }

  // Extractos Bancolombia suelen traer fechas tipo d/mm sin año. Usar año inferido.
  const noYear = s.match(/^(\d{1,2})[-/](\d{1,2})$/);
  if (noYear && fallbackYear) {
    const [, d, m] = noYear;
    return `${fallbackYear}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  }

  const d = new Date(s);
  if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  return null;
}

function daysBetween(a, b) {
  if (!a || !b) return 9999;
  const da = new Date(a + 'T00:00:00Z');
  const db = new Date(b + 'T00:00:00Z');
  return Math.round(Math.abs(da - db) / 86400000);
}

function isTotalOrHeaderLike(row) {
  const text = normalizeText(Object.values(row).join(' '));
  if (!text) return true;
  if (/total|saldo anterior|saldo inicial|suma|subtotal/.test(text)) return true;
  return false;
}

function detectBankExpense(description) {
  const d = normalizeText(description);
  const keys = [
    '4x1000', '4 x 1000', 'gmf', 'impto gobierno', 'impuesto gobierno',
    'comision', 'comisión', 'cuota manejo', 'iva', 'intereses', 'interes',
    'retencion', 'retención', 'cobro', 'cargo bancario', 'gasto bancario'
  ];
  return keys.some(k => d.includes(normalizeText(k)));
}

function normalizeDataset(parsed, { role }) {
  const sheet = parsed.selectedSheet;
  const headers = sheet.headers;
  const mapping = inferColumns(headers, role);

  if (!mapping.date) {
    // Intento suave: usar primera columna si parece fecha en varios registros
    mapping.date = headers[0];
  }
  if (!mapping.description) {
    mapping.description = headers.find(h => normalizeText(h).includes('detalle')) || headers[1] || headers[0];
  }

  const movements = [];
  let sequence = 1;

  for (const row of sheet.rows) {
    if (isTotalOrHeaderLike(row)) continue;

    const date = parseDate(row[mapping.date], row.__defaultYear || sheet.defaultYear || null);
    const description = String(row[mapping.description] ?? '').trim();
    const reference = mapping.reference ? String(row[mapping.reference] ?? '').trim() : '';
    const balance = mapping.balance ? parseNumber(row[mapping.balance]) : null;

    let rawValue = 0;
    let type = null;

    if (mapping.debit || mapping.credit) {
      const debit = mapping.debit ? parseNumber(row[mapping.debit]) : 0;
      const credit = mapping.credit ? parseNumber(row[mapping.credit]) : 0;

      if (Math.abs(debit) > 0 && Math.abs(credit) === 0) {
        rawValue = Math.abs(debit);
        type = 'ingreso';
      } else if (Math.abs(credit) > 0 && Math.abs(debit) === 0) {
        rawValue = Math.abs(credit);
        type = 'egreso';
      } else if (Math.abs(debit) > 0 && Math.abs(credit) > 0) {
        // Registro ambiguo; se conserva neto.
        const net = debit - credit;
        rawValue = Math.abs(net);
        type = net >= 0 ? 'ingreso' : 'egreso';
      }
    } else if (mapping.amount) {
      const amount = parseNumber(row[mapping.amount]);
      rawValue = Math.abs(amount);
      type = amount < 0 ? 'egreso' : 'ingreso';
    }

    if (!date && rawValue === 0 && !description) continue;
    if (rawValue === 0) continue;

    const movement = {
      id: `${role.toUpperCase()}-${String(sequence++).padStart(5, '0')}`,
      source: role,
      rowNumber: row.__rowNumber,
      date,
      description,
      reference,
      value: Math.round(rawValue * 100) / 100,
      type: type || 'sin_tipo',
      balance,
      isBankExpense: role === 'bank' ? detectBankExpense(description) : false,
      original: row
    };

    movements.push(movement);
  }

  return {
    role,
    fileName: parsed.fileName,
    sheetName: sheet.name,
    headers,
    mapping,
    totalRowsRead: sheet.rows.length,
    movements,
    stats: {
      ingresos: movements.filter(m => m.type === 'ingreso').reduce((a, m) => a + m.value, 0),
      egresos: movements.filter(m => m.type === 'egreso').reduce((a, m) => a + m.value, 0),
      gastosBancarios: movements.filter(m => m.isBankExpense).length
    }
  };
}

module.exports = { normalizeDataset, parseNumber, parseDate, daysBetween, detectBankExpense };
