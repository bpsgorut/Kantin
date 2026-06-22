const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");
const { Pool } = require("pg");

let sqliteDb;
let pgPool;

function getProjectRoot() {
  return path.join(__dirname, "..", "..");
}

function getDbPath() {
  const envPath = process.env.DATABASE_PATH;
  if (envPath) {
    return path.isAbsolute(envPath) ? envPath : path.join(getProjectRoot(), envPath);
  }
  return path.join(getProjectRoot(), "data", "kantin.db");
}

function isPostgres() {
  return Boolean(process.env.DATABASE_URL);
}

function formatSqliteUtcDateTime(d) {
  const pad = n => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(
    d.getUTCHours()
  )}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
}

function getMonthRange(month) {
  const [yRaw, mRaw] = String(month || "").split("-");
  const y = Number(yRaw);
  const m = Number(mRaw);
  if (!y || !m) return null;
  const start = new Date(Date.UTC(y, m - 1, 1, 0, 0, 0));
  const end = new Date(Date.UTC(y, m, 1, 0, 0, 0));
  return { start, end };
}

async function ensurePostgresSchema() {
  const pool = getPgPool();
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS categories (
      id BIGSERIAL PRIMARY KEY,
      name TEXT NOT NULL UNIQUE
    );

    CREATE TABLE IF NOT EXISTS products (
      id BIGSERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      category_id BIGINT NOT NULL REFERENCES categories(id) ON DELETE RESTRICT,
      price INTEGER NOT NULL DEFAULT 0,
      initial_stock INTEGER NOT NULL DEFAULT 0,
      stock INTEGER NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_products_category_id ON products(category_id);

    CREATE TABLE IF NOT EXISTS transactions (
      id BIGSERIAL PRIMARY KEY,
      buyer_name TEXT NOT NULL,
      is_paid INTEGER NOT NULL DEFAULT 0,
      payment_method TEXT,
      total_amount INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_transactions_created_at ON transactions(created_at);
    CREATE INDEX IF NOT EXISTS idx_transactions_is_paid ON transactions(is_paid);

    CREATE TABLE IF NOT EXISTS transaction_items (
      id BIGSERIAL PRIMARY KEY,
      transaction_id BIGINT NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
      product_id BIGINT NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
      product_name TEXT NOT NULL,
      category_name TEXT NOT NULL,
      qty INTEGER NOT NULL,
      price INTEGER NOT NULL,
      line_total INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_transaction_items_transaction_id ON transaction_items(transaction_id);
  `);
}

async function initDb() {
  if (isPostgres()) {
    if (!pgPool) {
      const sslEnabled = String(process.env.DATABASE_SSL || "true").toLowerCase() !== "false";
      pgPool = new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: sslEnabled ? { rejectUnauthorized: false } : undefined
      });
    }
    await pgPool.query("SELECT 1");
    await ensurePostgresSchema();
    await seedDefaults();
    return;
  }

  if (sqliteDb) return;

  const dbPath = getDbPath();
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });

  sqliteDb = new Database(dbPath);
  sqliteDb.pragma("journal_mode = WAL");
  sqliteDb.pragma("foreign_keys = ON");

  const schemaPath = path.join(__dirname, "schema.sql");
  const schemaSql = fs.readFileSync(schemaPath, "utf8");
  sqliteDb.exec(schemaSql);

  const columns = sqliteDb.prepare("PRAGMA table_info(products)").all();
  const hasStock = columns.some(c => c.name === "stock");
  if (!hasStock) {
    sqliteDb.exec("ALTER TABLE products ADD COLUMN stock INTEGER NOT NULL DEFAULT 0");
  }
  const hasInitialStock = columns.some(c => c.name === "initial_stock");
  if (!hasInitialStock) {
    sqliteDb.exec("ALTER TABLE products ADD COLUMN initial_stock INTEGER NOT NULL DEFAULT 0");
  }

  await seedDefaults();
}

function getSqliteDb() {
  if (!sqliteDb) {
    throw new Error("Database belum diinisialisasi. Panggil initDb() dulu.");
  }
  return sqliteDb;
}

function getPgPool() {
  if (!pgPool) {
    throw new Error("DATABASE_URL belum di-set untuk koneksi Postgres/Supabase.");
  }
  return pgPool;
}

async function seedDefaults() {
  const defaults = ["Snack Time", "Dunia Mie", "Minuman"];
  if (isPostgres()) {
    for (const name of defaults) {
      await getPgPool().query(
        "INSERT INTO categories (name) VALUES ($1) ON CONFLICT (name) DO NOTHING",
        [name]
      );
    }
    return;
  }

  const db = getSqliteDb();
  const insertCategory = db.prepare("INSERT OR IGNORE INTO categories (name) VALUES (?)");
  const tx = db.transaction(() => {
    for (const name of defaults) insertCategory.run(name);
  });
  tx();
}

async function listCategories() {
  if (isPostgres()) {
    const { rows } = await getPgPool().query(
      "SELECT id, name FROM categories ORDER BY name ASC"
    );
    return rows;
  }
  const db = getSqliteDb();
  return db.prepare("SELECT id, name FROM categories ORDER BY name ASC").all();
}

async function categoryExists(categoryId) {
  if (isPostgres()) {
    const { rowCount } = await getPgPool().query("SELECT 1 FROM categories WHERE id = $1", [
      categoryId
    ]);
    return rowCount > 0;
  }
  const db = getSqliteDb();
  return Boolean(db.prepare("SELECT 1 FROM categories WHERE id = ?").get(categoryId));
}

async function listProducts() {
  if (isPostgres()) {
    const { rows } = await getPgPool().query(
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
    );
    return rows;
  }

  const db = getSqliteDb();
  return db
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
}

async function insertProduct({ name, categoryId, price, initialStock, stock, isActive }) {
  if (isPostgres()) {
    const { rows } = await getPgPool().query(
      `
      INSERT INTO products (name, category_id, price, initial_stock, stock, is_active, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
      RETURNING id
      `,
      [name, categoryId, price, initialStock, stock, isActive]
    );
    return rows[0]?.id;
  }

  const db = getSqliteDb();
  const info = db
    .prepare(
      `
      INSERT INTO products (name, category_id, price, initial_stock, stock, is_active, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
      `
    )
    .run(name, categoryId, price, initialStock, stock, isActive);
  return Number(info.lastInsertRowid);
}

async function getProductById(id) {
  if (isPostgres()) {
    const { rows } = await getPgPool().query(
      "SELECT id, name, category_id, price, initial_stock, stock, is_active FROM products WHERE id = $1",
      [id]
    );
    return rows[0] || null;
  }
  const db = getSqliteDb();
  return (
    db
      .prepare(
        "SELECT id, name, category_id, price, initial_stock, stock, is_active FROM products WHERE id = ?"
      )
      .get(id) || null
  );
}

async function productExists(id) {
  if (isPostgres()) {
    const { rowCount } = await getPgPool().query("SELECT 1 FROM products WHERE id = $1", [id]);
    return rowCount > 0;
  }
  const db = getSqliteDb();
  return Boolean(db.prepare("SELECT 1 FROM products WHERE id = ?").get(id));
}

async function updateProduct({ id, name, categoryId, price, initialStock, stock, isActive }) {
  if (isPostgres()) {
    await getPgPool().query(
      `
      UPDATE products
      SET name = $1, category_id = $2, price = $3, initial_stock = $4, stock = $5, is_active = $6, updated_at = NOW()
      WHERE id = $7
      `,
      [name, categoryId, price, initialStock, stock, isActive, id]
    );
    return;
  }
  const db = getSqliteDb();
  db.prepare(
    `
    UPDATE products
    SET name = ?, category_id = ?, price = ?, initial_stock = ?, stock = ?, is_active = ?, updated_at = datetime('now')
    WHERE id = ?
    `
  ).run(name, categoryId, price, initialStock, stock, isActive, id);
}

async function refillProduct({ id, qty }) {
  if (isPostgres()) {
    await getPgPool().query(
      `
      UPDATE products
      SET
        stock = stock + $1,
        initial_stock = initial_stock + $1,
        is_active = 1,
        updated_at = NOW()
      WHERE id = $2
      `,
      [qty, id]
    );
    return;
  }
  const db = getSqliteDb();
  db.prepare(
    `
    UPDATE products
    SET
      stock = stock + ?,
      initial_stock = initial_stock + ?,
      is_active = 1,
      updated_at = datetime('now')
    WHERE id = ?
    `
  ).run(qty, qty, id);
}

async function resetProduct(id) {
  if (isPostgres()) {
    await getPgPool().query(
      `
      UPDATE products
      SET initial_stock = 0, stock = 0, is_active = 0, updated_at = NOW()
      WHERE id = $1
      `,
      [id]
    );
    return;
  }
  const db = getSqliteDb();
  db.prepare(
    `
    UPDATE products
    SET initial_stock = 0, stock = 0, is_active = 0, updated_at = datetime('now')
    WHERE id = ?
    `
  ).run(id);
}

async function deleteProduct(id) {
  if (isPostgres()) {
    await getPgPool().query("DELETE FROM products WHERE id = $1", [id]);
    return;
  }
  const db = getSqliteDb();
  db.prepare("DELETE FROM products WHERE id = ?").run(id);
}

async function listActiveProducts() {
  if (isPostgres()) {
    const { rows } = await getPgPool().query(
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
    );
    return rows;
  }
  const db = getSqliteDb();
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

async function listTransactions({ q, status, month }) {
  const monthRange = month ? getMonthRange(month) : null;

  if (isPostgres()) {
    const where = [];
    const params = [];
    const push = v => {
      params.push(v);
      return `$${params.length}`;
    };

    if (q) {
      where.push(`t.buyer_name ILIKE ${push(`%${q}%`)}`);
    }
    if (status === "paid") where.push("t.is_paid = 1");
    if (status === "unpaid") where.push("t.is_paid = 0");
    if (monthRange) {
      where.push(`t.created_at >= ${push(monthRange.start)}`);
      where.push(`t.created_at < ${push(monthRange.end)}`);
    }

    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

    const rowsResult = await getPgPool().query(
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
      `,
      params
    );

    const summaryResult = await getPgPool().query(
      `
      SELECT
        COALESCE(SUM(CASE WHEN is_paid = 1 THEN total_amount ELSE 0 END), 0) AS paid_total,
        COALESCE(SUM(CASE WHEN is_paid = 0 THEN total_amount ELSE 0 END), 0) AS unpaid_total
      FROM transactions t
      ${whereSql}
      `,
      params
    );

    return { rows: rowsResult.rows, summary: summaryResult.rows[0] };
  }

  const db = getSqliteDb();
  const where = [];
  const params = {};

  if (q) {
    where.push("t.buyer_name LIKE :q");
    params.q = `%${q}%`;
  }
  if (status === "paid") where.push("t.is_paid = 1");
  if (status === "unpaid") where.push("t.is_paid = 0");
  if (monthRange) {
    where.push("t.created_at >= :startAt AND t.created_at < :endAt");
    params.startAt = formatSqliteUtcDateTime(monthRange.start);
    params.endAt = formatSqliteUtcDateTime(monthRange.end);
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

  return { rows, summary };
}

async function createTransaction({ buyerName, isPaid, paymentMethod, transactionDate, items }) {
  if (isPostgres()) {
    const pool = getPgPool();
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const createdAt = transactionDate ? new Date(`${transactionDate}T00:00:00.000Z`) : null;

      const txInsert = await client.query(
        `
        INSERT INTO transactions (buyer_name, is_paid, payment_method, total_amount, created_at)
        VALUES ($1, $2, $3, 0, COALESCE($4, NOW()))
        RETURNING id
        `,
        [buyerName, isPaid, isPaid ? paymentMethod : null, createdAt]
      );
      const transactionId = txInsert.rows[0].id;

      let totalAmount = 0;
      for (const item of items) {
        const pRes = await client.query(
          `
          SELECT p.id, p.name, p.price, p.stock, c.name AS category_name
          FROM products p
          JOIN categories c ON c.id = p.category_id
          WHERE p.id = $1
          FOR UPDATE
          `,
          [item.productId]
        );
        const p = pRes.rows[0];
        if (!p) throw new Error("Ada barang yang tidak valid / tidak aktif.");
        if (item.qty <= 0) throw new Error("Qty harus > 0.");
        if (item.qty > p.stock) throw new Error(`Stock ${p.name} tidak cukup. Tersedia: ${p.stock}`);

        const lineTotal = Number(p.price) * item.qty;
        totalAmount += lineTotal;

        await client.query(
          `
          INSERT INTO transaction_items
            (transaction_id, product_id, product_name, category_name, qty, price, line_total)
          VALUES ($1, $2, $3, $4, $5, $6, $7)
          `,
          [transactionId, p.id, p.name, p.category_name, item.qty, p.price, lineTotal]
        );

        const nextStock = Number(p.stock) - item.qty;
        await client.query(
          `
          UPDATE products
          SET stock = $1, is_active = CASE WHEN $1 > 0 THEN 1 ELSE 0 END, updated_at = NOW()
          WHERE id = $2
          `,
          [nextStock, p.id]
        );
      }

      await client.query("UPDATE transactions SET total_amount = $1 WHERE id = $2", [
        totalAmount,
        transactionId
      ]);

      await client.query("COMMIT");
      return transactionId;
    } catch (e) {
      try {
        await client.query("ROLLBACK");
      } catch {}
      throw e;
    } finally {
      client.release();
    }
  }

  const db = getSqliteDb();
  const createDate = transactionDate || null;

  const createTx = db.transaction(() => {
    const insertTx = db.prepare(
      `
      INSERT INTO transactions (buyer_name, is_paid, payment_method, total_amount, created_at)
      VALUES (?, ?, ?, 0, COALESCE(?, datetime('now')))
      `
    );

    const txInfo = insertTx.run(buyerName, isPaid, isPaid ? paymentMethod : null, createDate);
    const transactionId = txInfo.lastInsertRowid;

    const getProduct = db.prepare(
      `
      SELECT p.id, p.name, p.price, p.stock, c.name AS category_name
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
    for (const item of items) {
      const p = getProduct.get(item.productId);
      if (!p) throw new Error("Ada barang yang tidak valid / tidak aktif.");
      if (item.qty <= 0) throw new Error("Qty harus > 0.");
      if (item.qty > p.stock) throw new Error(`Stock ${p.name} tidak cukup. Tersedia: ${p.stock}`);

      const lineTotal = p.price * item.qty;
      totalAmount += lineTotal;
      insertItem.run(transactionId, p.id, p.name, p.category_name, item.qty, p.price, lineTotal);

      db.prepare(
        "UPDATE products SET stock = stock - ?, is_active = CASE WHEN stock - ? > 0 THEN 1 ELSE 0 END, updated_at = datetime('now') WHERE id = ?"
      ).run(item.qty, item.qty, item.productId);
    }

    db.prepare("UPDATE transactions SET total_amount = ? WHERE id = ?").run(
      totalAmount,
      transactionId
    );

    return Number(transactionId);
  });

  return createTx();
}

async function getTransactionById(id) {
  if (isPostgres()) {
    const { rows } = await getPgPool().query(
      "SELECT id, buyer_name, is_paid, payment_method, total_amount, DATE(created_at) AS created_date FROM transactions WHERE id = $1",
      [id]
    );
    return rows[0] || null;
  }
  const db = getSqliteDb();
  return (
    db
      .prepare(
        `
        SELECT id, buyer_name, is_paid, payment_method, total_amount, DATE(created_at) AS created_date
        FROM transactions
        WHERE id = ?
        `
      )
      .get(id) || null
  );
}

async function listTransactionItems(transactionId) {
  if (isPostgres()) {
    const { rows } = await getPgPool().query(
      `
      SELECT id, product_id, product_name, category_name, qty, price, line_total
      FROM transaction_items
      WHERE transaction_id = $1
      ORDER BY id ASC
      `,
      [transactionId]
    );
    return rows;
  }
  const db = getSqliteDb();
  return db
    .prepare(
      `
      SELECT id, product_id, product_name, category_name, qty, price, line_total
      FROM transaction_items
      WHERE transaction_id = ?
      ORDER BY id ASC
      `
    )
    .all(transactionId);
}

async function transactionExists(id) {
  if (isPostgres()) {
    const { rowCount } = await getPgPool().query("SELECT 1 FROM transactions WHERE id = $1", [id]);
    return rowCount > 0;
  }
  const db = getSqliteDb();
  return Boolean(db.prepare("SELECT 1 FROM transactions WHERE id = ?").get(id));
}

async function updateTransactionPayment({ id, isPaid, paymentMethod }) {
  if (isPostgres()) {
    await getPgPool().query(
      "UPDATE transactions SET is_paid = $1, payment_method = $2 WHERE id = $3",
      [isPaid, isPaid ? paymentMethod : null, id]
    );
    return;
  }
  const db = getSqliteDb();
  db.prepare("UPDATE transactions SET is_paid = ?, payment_method = ? WHERE id = ?").run(
    isPaid,
    isPaid ? paymentMethod : null,
    id
  );
}

async function deleteTransaction(id) {
  if (isPostgres()) {
    await getPgPool().query("DELETE FROM transactions WHERE id = $1", [id]);
    return;
  }
  const db = getSqliteDb();
  db.prepare("DELETE FROM transactions WHERE id = ?").run(id);
}

module.exports = {
  initDb,
  getDbPath,
  listCategories,
  categoryExists,
  listProducts,
  insertProduct,
  getProductById,
  productExists,
  updateProduct,
  refillProduct,
  resetProduct,
  deleteProduct,
  listActiveProducts,
  listTransactions,
  createTransaction,
  getTransactionById,
  listTransactionItems,
  transactionExists,
  updateTransactionPayment,
  deleteTransaction
};
