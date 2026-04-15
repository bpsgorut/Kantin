const express = require("express");
const { getDb } = require("../../storage/db");
const { toInt } = require("../lib/format");

const router = express.Router();

function getCategories(db) {
  return db.prepare("SELECT id, name FROM categories ORDER BY name ASC").all();
}

router.get("/", (req, res) => {
  const db = getDb();
  const products = db
    .prepare(
      `
      SELECT
        p.id,
        p.name,
        p.price,
        p.initial_stock,
        p.stock,
        p.is_active,
        c.name AS category_name,
        c.id AS category_id
      FROM products p
      JOIN categories c ON c.id = p.category_id
      ORDER BY c.name ASC, p.name ASC
      `
    )
    .all();

  res.render("products/index", {
    title: "Produk",
    products,
    msg: req.query.msg || null,
    msgType: req.query.type || "info"
  });
});

router.get("/new", (req, res) => {
  const db = getDb();
  const categories = getCategories(db);
  res.render("products/new", { title: "Tambah Produk", categories, errors: [], form: {} });
});

router.post("/", (req, res) => {
  const db = getDb();
  const categories = getCategories(db);

  const name = String(req.body.name || "").trim();
  const categoryId = toInt(req.body.category_id, 0);
  const price = toInt(req.body.price, 0);
  const initialStock = toInt(req.body.initial_stock, 0);
  const stock = initialStock; // Set current stock to initial stock initially
  const isActive = stock > 0 ? 1 : 0;

  const errors = [];
  if (!name) errors.push("Nama produk wajib diisi.");
  if (!categoryId) errors.push("Kategori wajib dipilih.");
  if (!Number.isFinite(price) || price < 0) errors.push("Harga harus angka >= 0.");
  if (!Number.isFinite(initialStock) || initialStock < 0) errors.push("Stock awal harus angka >= 0.");

  const categoryExists = db
    .prepare("SELECT 1 FROM categories WHERE id = ?")
    .get(categoryId);
  if (!categoryExists) errors.push("Kategori tidak valid.");

  if (errors.length) {
    return res.status(400).render("products/new", {
      title: "Tambah Produk",
      categories,
      errors,
      form: { name, category_id: categoryId, price, initial_stock: initialStock, is_active: isActive }
    });
  }

  db.prepare(
    `
    INSERT INTO products (name, category_id, price, initial_stock, stock, is_active, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    `
  ).run(name, categoryId, price, initialStock, stock, isActive);

  res.redirect("/products?msg=Produk%20ditambahkan&type=success");
});

router.get("/:id/edit", (req, res) => {
  const db = getDb();
  const categories = getCategories(db);
  const id = toInt(req.params.id, 0);

  const product = db
    .prepare("SELECT id, name, category_id, price, initial_stock, stock, is_active FROM products WHERE id = ?")
    .get(id);

  if (!product) return res.status(404).render("404", { title: "Produk tidak ditemukan" });

  res.render("products/edit", {
    title: "Edit Produk",
    categories,
    errors: [],
    form: product
  });
});

router.put("/:id", (req, res) => {
  const db = getDb();
  const categories = getCategories(db);
  const id = toInt(req.params.id, 0);

  const name = String(req.body.name || "").trim();
  const categoryId = toInt(req.body.category_id, 0);
  const price = toInt(req.body.price, 0);
  const initialStock = toInt(req.body.initial_stock, 0);
  const stock = toInt(req.body.stock, 0);
  const isActive = stock > 0 ? 1 : 0;

  const errors = [];
  if (!id) errors.push("ID tidak valid.");
  if (!name) errors.push("Nama produk wajib diisi.");
  if (!categoryId) errors.push("Kategori wajib dipilih.");
  if (!Number.isFinite(price) || price < 0) errors.push("Harga harus angka >= 0.");
  if (!Number.isFinite(initialStock) || initialStock < 0) errors.push("Stock awal harus angka >= 0.");
  if (!Number.isFinite(stock) || stock < 0) errors.push("Stock saat ini harus angka >= 0.");

  const productExists = db.prepare("SELECT 1 FROM products WHERE id = ?").get(id);
  if (!productExists) errors.push("Produk tidak ditemukan.");

  const categoryExists = db
    .prepare("SELECT 1 FROM categories WHERE id = ?")
    .get(categoryId);
  if (!categoryExists) errors.push("Kategori tidak valid.");

  if (errors.length) {
    return res.status(400).render("products/edit", {
      title: "Edit Produk",
      categories,
      errors,
      form: { id, name, category_id: categoryId, price, initial_stock: initialStock, stock, is_active: isActive }
    });
  }

  db.prepare(
    `
    UPDATE products
    SET name = ?, category_id = ?, price = ?, initial_stock = ?, stock = ?, is_active = ?, updated_at = datetime('now')
    WHERE id = ?
    `
  ).run(name, categoryId, price, initialStock, stock, isActive, id);

  res.redirect("/products?msg=Produk%20diupdate&type=success");
});

router.delete("/:id", (req, res) => {
  const db = getDb();
  const id = toInt(req.params.id, 0);
  if (!id) return res.redirect("/products?msg=ID%20tidak%20valid&type=error");

  try {
    db.prepare("DELETE FROM products WHERE id = ?").run(id);
    return res.redirect("/products?msg=Produk%20dihapus&type=success");
  } catch (e) {
    return res.redirect("/products?msg=Produk%20tidak%20bisa%20dihapus%20(terpakai%20di%20transaksi)&type=error");
  }
});

module.exports = router;

