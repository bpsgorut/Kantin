const express = require("express");
const {
  listCategories,
  categoryExists,
  listProducts,
  insertProduct,
  getProductById,
  productExists,
  updateProduct,
  refillProduct,
  resetProduct,
  deleteProduct
} = require("../../storage/db");
const { toInt } = require("../lib/format");

const router = express.Router();

router.get("/", async (req, res, next) => {
  try {
    const products = await listProducts();
    res.render("products/index", {
      title: "Produk",
      products,
      msg: req.query.msg || null,
      msgType: req.query.type || "info"
    });
  } catch (e) {
    next(e);
  }
});

router.get("/new", async (req, res, next) => {
  try {
    const categories = await listCategories();
    res.render("products/new", { title: "Tambah Produk", categories, errors: [], form: {} });
  } catch (e) {
    next(e);
  }
});

router.post("/", async (req, res, next) => {
  try {
    const categories = await listCategories();

    const name = String(req.body.name || "").trim();
    const categoryId = toInt(req.body.category_id, 0);
    const price = toInt(req.body.price, 0);
    const initialStock = toInt(req.body.initial_stock, 0);
    const stock = initialStock;
    const isActive = stock > 0 ? 1 : 0;

    const errors = [];
    if (!name) errors.push("Nama produk wajib diisi.");
    if (!categoryId) errors.push("Kategori wajib dipilih.");
    if (!Number.isFinite(price) || price < 0) errors.push("Harga harus angka >= 0.");
    if (!Number.isFinite(initialStock) || initialStock < 0) errors.push("Stock awal harus angka >= 0.");

    const categoryOk = await categoryExists(categoryId);
    if (!categoryOk) errors.push("Kategori tidak valid.");

    if (errors.length) {
      return res.status(400).render("products/new", {
        title: "Tambah Produk",
        categories,
        errors,
        form: { name, category_id: categoryId, price, initial_stock: initialStock, is_active: isActive }
      });
    }

    await insertProduct({ name, categoryId, price, initialStock, stock, isActive });

    res.redirect("/products?msg=Produk%20ditambahkan&type=success");
  } catch (e) {
    next(e);
  }
});

router.get("/:id/edit", async (req, res, next) => {
  try {
    const categories = await listCategories();
    const id = toInt(req.params.id, 0);
    const product = await getProductById(id);

    if (!product) return res.status(404).render("404", { title: "Produk tidak ditemukan" });

    res.render("products/edit", {
      title: "Edit Produk",
      categories,
      errors: [],
      form: product
    });
  } catch (e) {
    next(e);
  }
});

router.put("/:id", async (req, res, next) => {
  try {
    const categories = await listCategories();
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

    const productOk = await productExists(id);
    if (!productOk) errors.push("Produk tidak ditemukan.");

    const categoryOk = await categoryExists(categoryId);
    if (!categoryOk) errors.push("Kategori tidak valid.");

    if (errors.length) {
      return res.status(400).render("products/edit", {
        title: "Edit Produk",
        categories,
        errors,
        form: { id, name, category_id: categoryId, price, initial_stock: initialStock, stock, is_active: isActive }
      });
    }

    await updateProduct({ id, name, categoryId, price, initialStock, stock, isActive });

    res.redirect("/products?msg=Produk%20diupdate&type=success");
  } catch (e) {
    next(e);
  }
});

router.put("/:id/refill", async (req, res, next) => {
  try {
    const id = toInt(req.params.id, 0);
    const qty = toInt(req.body.qty, 0);

    if (!id) return res.redirect("/products?msg=ID%20tidak%20valid&type=error");
    if (!Number.isFinite(qty) || qty <= 0)
      return res.redirect("/products?msg=Jumlah%20refill%20tidak%20valid&type=error");

    const productOk = await productExists(id);
    if (!productOk) return res.redirect("/products?msg=Produk%20tidak%20ditemukan&type=error");

    await refillProduct({ id, qty });

    res.redirect("/products?msg=Stock%20berhasil%20direfill&type=success");
  } catch (e) {
    next(e);
  }
});

router.put("/:id/reset", async (req, res, next) => {
  try {
    const id = toInt(req.params.id, 0);

    if (!id) return res.redirect("/products?msg=ID%20tidak%20valid&type=error");

    const productOk = await productExists(id);
    if (!productOk) return res.redirect("/products?msg=Produk%20tidak%20ditemukan&type=error");

    await resetProduct(id);

    res.redirect("/products?msg=Data%20produk%20berhasil%20direset&type=success");
  } catch (e) {
    next(e);
  }
});

router.delete("/:id", async (req, res) => {
  const id = toInt(req.params.id, 0);
  if (!id) return res.redirect("/products?msg=ID%20tidak%20valid&type=error");

  try {
    await deleteProduct(id);
    return res.redirect("/products?msg=Produk%20dihapus&type=success");
  } catch (e) {
    return res.redirect(
      "/products?msg=Produk%20tidak%20bisa%20dihapus%20(terpakai%20di%20transaksi)&type=error"
    );
  }
});

module.exports = router;
