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

function isValidDateParts(year, month, day) {
  const y = Number(year);
  const m = Number(month);
  const d = Number(day);
  if (!y || m < 1 || m > 12 || d < 1 || d > 31) return false;
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

function toIsoDate(year, month, day) {
  if (!isValidDateParts(year, month, day)) return null;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function parseDate(value, fallbackYear = null, fallbackMonth = null) {
  if (!value) return null;
  if (value instanceof Date && !isNaN(value)) return value.toISOString().slice(0, 10);

  const s = String(value).trim();
  if (!s) return null;

  // ISO o yyyy-mm-dd / yyyy/mm/dd
  const iso = s.match(/(20\d{2}|19\d{2})[-/](\d{1,2})[-/](\d{1,2})/);
  if (iso) {
    const [, y, m, d] = iso;
    return toIsoDate(Number(y), Number(m), Number(d));
  }

  // Fechas con año: pueden venir como DD/MM/YYYY o MM/DD/YYYY según cómo Excel exportó el archivo.
  // Si el mes del archivo se puede inferir, se usa para desambiguar. Esto corrige auxiliares
  // contables que traen 02/28/2026 para febrero, mientras el banco trae 28/02 sin año.
  const withYear = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](20\d{2}|19\d{2})$/);
  if (withYear) {
    const a = Number(withYear[1]);
    const b = Number(withYear[2]);
    const y = Number(withYear[3]);
    const fm = Number(fallbackMonth || 0);

    let day;
    let month;

    if (fm && a === fm && b !== fm) {
      // MM/DD/YYYY
      month = a;
      day = b;
    } else if (fm && b === fm) {
      // DD/MM/YYYY
      day = a;
      month = b;
    } else if (a > 12 && b <= 12) {
      day = a;
      month = b;
    } else if (b > 12 && a <= 12) {
      month = a;
      day = b;
    } else {
      // Preferencia latinoamericana cuando no hay forma de saberlo.
      day = a;
      month = b;
    }

    return toIsoDate(y, month, day);
  }

  // Extractos Bancolombia suelen traer fechas tipo d/mm sin año. Usar año inferido.
  const noYear = s.match(/^(\d{1,2})[-/](\d{1,2})$/);
  if (noYear && fallbackYear) {
    const [, d, m] = noYear;
    return toIsoDate(Number(fallbackYear), Number(m), Number(d));
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
  if (!d) return false;

  const patterns = [
    /\b4x1000\b/,
    /\b4\s*x\s*1000\b/,
    /\bgmf\b/,
    /impto gobierno/,
    /impuesto gobierno/,
    /\bcomis(?:ion)?\b/,
    /\bcomision\b/,
    /\bcuota manejo\b/,
    /\biva\b/,
    /\bintereses\b/,
    /\binteres\b/,
    /\bretencion\b/,
    /\bretencion fuente\b/,
    /\bcargo bancario\b/,
    /\bgasto bancario\b/,
    /rev\.?aut cuota manejo/,
    /abono desembolso de credito/
  ];

  return patterns.some(p => p.test(d));
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
    // En archivos internos sí saltamos filas de totales/subtotales antes de procesar.
    // En extractos bancarios NO lo hacemos aquí, porque algunas descripciones o filas reales
    // pueden contener textos que disparen falsos positivos. Primero validamos fecha + valor.
    if (role !== 'bank' && isTotalOrHeaderLike(row)) continue;

    const date = parseDate(row[mapping.date], row.__defaultYear || sheet.defaultYear || null, row.__defaultMonth || sheet.defaultMonth || null);
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

    // No aceptar totales o filas de cierre sin fecha. En CONTAI la fila total trae
    // Débitos/Créditos pero no fecha ni detalle, y duplicaba el neto interno.
    if (!date) continue;
    if (rawValue === 0) continue;

    // En banco, después de validar fecha y valor, sí descartamos filas claramente informativas.
    // Esto evita perder movimientos reales como pagos grandes de terceros.
    if (role === 'bank') {
      const rowText = normalizeText(Object.values(row).join(' '));
      if (/saldo anterior|saldo inicial|total abonos|total cargos|resumen/.test(rowText)) continue;
    }

    if (role === 'internal' && !description) continue;

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
