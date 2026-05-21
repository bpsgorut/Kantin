const express = require("express");
const {
  listActiveProducts,
  listTransactions,
  createTransaction,
  getTransactionById,
  listTransactionItems,
  transactionExists,
  updateTransactionPayment,
  deleteTransaction
} = require("../../storage/db");
const { toInt, toBoolInt } = require("../lib/format");

const router = express.Router();

function shiftMonth(month, delta) {
  const [yRaw, mRaw] = String(month || "").split("-");
  const y = Number(yRaw);
  const m = Number(mRaw);
  if (!y || !m) return month;
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  const yy = String(d.getUTCFullYear());
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${yy}-${mm}`;
}

function formatMonthLabel(month) {
  const [yRaw, mRaw] = String(month || "").split("-");
  const y = Number(yRaw);
  const m = Number(mRaw);
  if (!y || !m) return String(month || "");
  const d = new Date(Date.UTC(y, m - 1, 1));
  return new Intl.DateTimeFormat("id-ID", { month: "long", year: "numeric" }).format(d);
}

function buildTransactionsUrl({ month, q, status }) {
  const sp = new URLSearchParams();
  if (month) sp.set("month", month);
  if (q) sp.set("q", q);
  if (status) sp.set("status", status);
  const qs = sp.toString();
  return qs ? `/transactions?${qs}` : "/transactions";
}

router.get("/", async (req, res, next) => {
  const q = String(req.query.q || "").trim();
  const status = String(req.query.status || "all");

  const now = new Date();
  const currentMonth = String(now.getMonth() + 1).padStart(2, "0");
  const currentYear = String(now.getFullYear());

  const month = req.query.month || `${currentYear}-${currentMonth}`;
  const monthLabel = formatMonthLabel(month);
  const prevMonth = shiftMonth(month, -1);
  const nextMonth = shiftMonth(month, 1);
  const prevUrl = buildTransactionsUrl({ month: prevMonth, q, status });
  const nextUrl = buildTransactionsUrl({ month: nextMonth, q, status });

  try {
    const { rows, summary } = await listTransactions({ q, status, month });
    res.render("transactions/index", {
      title: "Transaksi",
      rows,
      q,
      status,
      month,
      monthLabel,
      prevUrl,
      nextUrl,
      summary,
      msg: req.query.msg || null,
      msgType: req.query.type || "info"
    });
  } catch (e) {
    next(e);
  }
});

router.get("/new", async (req, res, next) => {
  try {
    const products = await listActiveProducts();
    const today = new Date().toISOString().split("T")[0];
    res.render("transactions/new", {
      title: "Tambah Transaksi",
      products,
      errors: [],
      form: {
        buyer_name: "",
        is_paid: 0,
        payment_method: "cash",
        transaction_date: today
      }
    });
  } catch (e) {
    next(e);
  }
});

router.post("/", async (req, res, next) => {
  try {
    const products = await listActiveProducts();

    const buyerName = String(req.body.buyer_name || "").trim();
    const isPaid = toBoolInt(req.body.is_paid);
    const paymentMethodRaw = String(req.body.payment_method || "").trim().toLowerCase();
    const paymentMethod = paymentMethodRaw === "qris" ? "qris" : "cash";
    const transactionDate = String(req.body.transaction_date || "").trim();

    const productIds = Array.isArray(req.body.product_id)
      ? req.body.product_id
      : [req.body.product_id].filter(Boolean);
    const qtys = Array.isArray(req.body.qty) ? req.body.qty : [req.body.qty].filter(Boolean);

    const itemsInput = [];
    for (let i = 0; i < Math.max(productIds.length, qtys.length); i++) {
      const productId = toInt(productIds[i], 0);
      const qty = toInt(qtys[i], 0);
      if (!productId || !qty) continue;
      itemsInput.push({ productId, qty });
    }

    const errors = [];
    if (!buyerName) errors.push("Nama pembeli wajib diisi.");
    if (!itemsInput.length) errors.push("Minimal 1 barang harus diisi.");
    if (isPaid !== 0 && isPaid !== 1) errors.push("Status bayar tidak valid.");
    if (!transactionDate) errors.push("Tanggal transaksi wajib diisi.");

    if (errors.length) {
      return res.status(400).render("transactions/new", {
        title: "Tambah Transaksi",
        products,
        errors,
        form: {
          buyer_name: buyerName,
          is_paid: isPaid,
          payment_method: paymentMethod,
          transaction_date: transactionDate
        }
      });
    }

    const transactionId = await createTransaction({
      buyerName,
      isPaid,
      paymentMethod,
      transactionDate,
      items: itemsInput
    });

    res.redirect(`/transactions/${transactionId}?msg=Transaksi%20dibuat&type=success`);
  } catch (e) {
    try {
      const products = await listActiveProducts();
      res.status(400).render("transactions/new", {
        title: "Tambah Transaksi",
        products,
        errors: [e?.message || "Gagal membuat transaksi."],
        form: {
          buyer_name: String(req.body.buyer_name || "").trim(),
          is_paid: toBoolInt(req.body.is_paid),
          payment_method: String(req.body.payment_method || "").trim().toLowerCase() === "qris" ? "qris" : "cash",
          transaction_date: String(req.body.transaction_date || "").trim()
        }
      });
    } catch (e2) {
      next(e2);
    }
  }
});

router.get("/:id", async (req, res, next) => {
  try {
    const id = toInt(req.params.id, 0);
    const tx = await getTransactionById(id);
    if (!tx) return res.status(404).render("404", { title: "Transaksi tidak ditemukan" });

    const items = await listTransactionItems(id);

    res.render("transactions/show", {
      title: "Detail Transaksi",
      tx,
      items,
      msg: req.query.msg || null,
      msgType: req.query.type || "info"
    });
  } catch (e) {
    next(e);
  }
});

router.put("/:id/payment", async (req, res, next) => {
  try {
    const id = toInt(req.params.id, 0);
    const isPaid = toBoolInt(req.body.is_paid);
    const paymentMethodRaw = String(req.body.payment_method || "").trim().toLowerCase();
    const paymentMethod = paymentMethodRaw === "qris" ? "qris" : "cash";

    const ok = await transactionExists(id);
    if (!ok) return res.status(404).render("404", { title: "Transaksi tidak ditemukan" });

    await updateTransactionPayment({ id, isPaid, paymentMethod });
    res.redirect(`/transactions/${id}?msg=Status%20pembayaran%20diupdate&type=success`);
  } catch (e) {
    next(e);
  }
});

router.delete("/:id", async (req, res, next) => {
  try {
    const id = toInt(req.params.id, 0);
    if (!id) return res.redirect("/transactions?msg=ID%20tidak%20valid&type=error");

    await deleteTransaction(id);
    res.redirect("/transactions?msg=Transaksi%20dihapus&type=success");
  } catch (e) {
    next(e);
  }
});

module.exports = router;
