require("dotenv").config();
const path = require("path");
const express = require("express");
const methodOverride = require("method-override");
const morgan = require("morgan");

const { initDb } = require("./storage/db");
const { formatRupiah, formatTanggal } = require("./web/lib/format");
const transactionsRouter = require("./web/routes/transactions");
const productsRouter = require("./web/routes/products");

(async () => {
  await initDb();

  const app = express();
  const PORT = Number(process.env.PORT || 3000);

  app.set("view engine", "ejs");
  app.set("views", path.join(__dirname, "web", "views"));

  app.locals.formatRupiah = formatRupiah;
  app.locals.formatTanggal = formatTanggal;

  const logFormat = process.env.NODE_ENV === "production" ? "combined" : "dev";
  app.use(morgan(logFormat));
  app.use(express.urlencoded({ extended: false }));
  app.use(express.json());
  app.use(methodOverride("_method"));
  app.use("/static", express.static(path.join(__dirname, "web", "static")));

  app.get("/", (req, res) => res.redirect("/transactions"));

  app.use("/transactions", transactionsRouter);
  app.use("/products", productsRouter);

  app.use((req, res) => {
    res.status(404).render("404", { title: "Tidak ditemukan" });
  });

  app.use((err, req, res, next) => {
    console.error(err);
    res.status(500).render("500", { title: "Terjadi kesalahan", message: err?.message });
  });

  app.listen(PORT, () => {
    console.log(`Kantin berjalan di http://localhost:${PORT}`);
  });
})().catch(err => {
  console.error(err);
  process.exit(1);
});
