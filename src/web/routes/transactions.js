const express = require("express");
const { getDb } = require("../../storage/db");
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

function getActiveProducts(db) {
  return db
    .prepare(
      `
      SELECT
        p.id,
        p.name,
        p.price,
        p.stock,
        c.name AS category_name
      FROM products p
      JOIN categories c ON c.id = p.category_id
      WHERE p.stock > 0
      ORDER BY c.name ASC, p.name ASC
      `
    )
    .all();
}

router.get("/", (req, res) => {
  const db = getDb();

  const q = String(req.query.q || "").trim();
  const status = String(req.query.status || "all");
  
  // Default ke bulan & tahun saat ini
  const now = new Date();
  const currentMonth = String(now.getMonth() + 1).padStart(2, '0');
  const currentYear = String(now.getFullYear());
  
  const month = req.query.month || `${currentYear}-${currentMonth}`;
  const monthLabel = formatMonthLabel(month);
  const prevMonth = shiftMonth(month, -1);
  const nextMonth = shiftMonth(month, 1);
  const prevUrl = buildTransactionsUrl({ month: prevMonth, q, status });
  const nextUrl = buildTransactionsUrl({ month: nextMonth, q, status });

  const where = [];
  const params = {};

  if (q) {
    where.push("t.buyer_name LIKE :q");
    params.q = `%${q}%`;
  }
  if (status === "paid") {
    where.push("t.is_paid = 1");
  } else if (status === "unpaid") {
    where.push("t.is_paid = 0");
  }
  
  if (month) {
    where.push("strftime('%Y-%m', t.created_at) = :month");
    params.month = month;
  }

  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

  const rows = db
    .prepare(
      `
      SELECT
        t.id,
        t.buyer_name,
        t.is_paid,
        t.payment_method,
        t.total_amount,
        DATE(t.created_at) AS created_date,
        (
          SELECT COALESCE(SUM(qty), 0)
          FROM transaction_items ti
          WHERE ti.transaction_id = t.id
        ) AS total_qty
      FROM transactions t
      ${whereSql}
      ORDER BY t.created_at DESC, t.id DESC
      LIMIT 500
      `
    )
    .all(params);

  const summary = db
    .prepare(
      `
      SELECT
        COALESCE(SUM(CASE WHEN is_paid = 1 THEN total_amount ELSE 0 END), 0) AS paid_total,
        COALESCE(SUM(CASE WHEN is_paid = 0 THEN total_amount ELSE 0 END), 0) AS unpaid_total
      FROM transactions t
      ${whereSql}
      `
    )
    .get(params);

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
});

router.get("/new", (req, res) => {
  const db = getDb();
  const products = getActiveProducts(db);
  const today = new Date().toISOString().split('T')[0];
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
});

router.post("/", (req, res) => {
  const db = getDb();
  const products = getActiveProducts(db);

  const buyerName = String(req.body.buyer_name || "").trim();
  const isPaid = toBoolInt(req.body.is_paid);
  const paymentMethodRaw = String(req.body.payment_method || "").trim().toLowerCase();
  const paymentMethod = paymentMethodRaw === "qris" ? "qris" : "cash";
  const transactionDate = String(req.body.transaction_date || "").trim();

  const productIds = Array.isArray(req.body.product_id) ? req.body.product_id : [req.body.product_id].filter(Boolean);
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
      form: { buyer_name: buyerName, is_paid: isPaid, payment_method: paymentMethod, transaction_date: transactionDate }
    });
  }

  const createDate = transactionDate || null;

  const createTx = db.transaction(() => {
    const insertTx = db
      .prepare(
        `
        INSERT INTO transactions (buyer_name, is_paid, payment_method, total_amount, created_at)
        VALUES (?, ?, ?, 0, COALESCE(?, datetime('now')))
        `
      );

    const txInfo = insertTx.run(buyerName, isPaid, isPaid ? paymentMethod : null, createDate);
    const transactionId = txInfo.lastInsertRowid;

    const getProduct = db.prepare(
      `
      SELECT p.id, p.name, p.price, c.name AS category_name
      FROM products p
      JOIN categories c ON c.id = p.category_id
      WHERE p.id = ? AND p.stock > 0
      `
    );

    const insertItem = db.prepare(
      `
      INSERT INTO transaction_items
        (transaction_id, product_id, product_name, category_name, qty, price, line_total)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      `
    );

    let totalAmount = 0;
    for (const item of itemsInput) {
      const p = getProduct.get(item.productId);
      if (!p) throw new Error("Ada barang yang tidak valid / tidak aktif.");
      if (item.qty <= 0) throw new Error("Qty harus > 0.");
      if (item.qty > p.stock) throw new Error(`Stock ${p.name} tidak cukup. Tersedia: ${p.stock}`);

      const lineTotal = p.price * item.qty;
      totalAmount += lineTotal;
      insertItem.run(
        transactionId,
        p.id,
        p.name,
        p.category_name,
        item.qty,
        p.price,
        lineTotal
      );

      db.prepare("UPDATE products SET stock = stock - ?, is_active = CASE WHEN stock - ? > 0 THEN 1 ELSE 0 END WHERE id = ?")
        .run(item.qty, item.qty, item.productId);
    }

    db.prepare("UPDATE transactions SET total_amount = ? WHERE id = ?").run(
      totalAmount,
      transactionId
    );

    return transactionId;
  });

  try {
    const transactionId = createTx();
    res.redirect(`/transactions/${transactionId}?msg=Transaksi%20dibuat&type=success`);
  } catch (e) {
    res.status(400).render("transactions/new", {
      title: "Tambah Transaksi",
      products,
      errors: [e?.message || "Gagal membuat transaksi."],
      form: { buyer_name: buyerName, is_paid: isPaid, payment_method: paymentMethod }
    });
  }
});

router.get("/:id", (req, res) => {
  const db = getDb();
  const id = toInt(req.params.id, 0);

  const tx = db
    .prepare(
      `
      SELECT id, buyer_name, is_paid, payment_method, total_amount, DATE(created_at) AS created_date
      FROM transactions
      WHERE id = ?
      `
    )
    .get(id);

  if (!tx) return res.status(404).render("404", { title: "Transaksi tidak ditemukan" });

  const items = db
    .prepare(
      `
      SELECT id, product_id, product_name, category_name, qty, price, line_total
      FROM transaction_items
      WHERE transaction_id = ?
      ORDER BY id ASC
      `
    )
    .all(id);

  res.render("transactions/show", {
    title: `Transaksi #${tx.id}`,
    tx,
    items,
    msg: req.query.msg || null,
    msgType: req.query.type || "info"
  });
});

router.put("/:id/payment", (req, res) => {
  const db = getDb();
  const id = toInt(req.params.id, 0);
  const isPaid = toBoolInt(req.body.is_paid);
  const paymentMethodRaw = String(req.body.payment_method || "").trim().toLowerCase();
  const paymentMethod = paymentMethodRaw === "qris" ? "qris" : "cash";

  const txExists = db.prepare("SELECT 1 FROM transactions WHERE id = ?").get(id);
  if (!txExists) return res.status(404).render("404", { title: "Transaksi tidak ditemukan" });

  db.prepare("UPDATE transactions SET is_paid = ?, payment_method = ? WHERE id = ?").run(
    isPaid,
    isPaid ? paymentMethod : null,
    id
  );

  res.redirect(`/transactions/${id}?msg=Status%20pembayaran%20diupdate&type=success`);
});

router.delete("/:id", (req, res) => {
  const db = getDb();
  const id = toInt(req.params.id, 0);
  if (!id) return res.redirect("/transactions?msg=ID%20tidak%20valid&type=error");

  db.prepare("DELETE FROM transactions WHERE id = ?").run(id);
  res.redirect("/transactions?msg=Transaksi%20dihapus&type=success");
});

module.exports = router;
