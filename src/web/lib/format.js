function formatRupiah(amount) {
  const n = Number(amount || 0);
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0
  }).format(n);
}

function toInt(value, fallback = 0) {
  const n = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(n) ? n : fallback;
}

function toBoolInt(value) {
  return value === "1" || value === 1 || value === true || value === "true" ? 1 : 0;
}

function formatTanggal(value) {
  if (!value) return "";
  let d;
  if (value instanceof Date) {
    d = value;
  } else {
    const s = String(value).trim();
    if (!s) return "";
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
      d = new Date(`${s}T00:00:00.000Z`);
    } else {
      d = new Date(s);
    }
  }
  if (Number.isNaN(d.getTime())) return String(value);
  return new Intl.DateTimeFormat("id-ID", {
    day: "2-digit",
    month: "long",
    year: "numeric"
  }).format(d);
}

module.exports = {
  formatRupiah,
  formatTanggal,
  toInt,
  toBoolInt
};
