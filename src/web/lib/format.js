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

module.exports = {
  formatRupiah,
  toInt,
  toBoolInt
};

