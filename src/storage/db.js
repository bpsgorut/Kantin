const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");

let db;

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

function initDb() {
  if (db) return db;

  const dbPath = getDbPath();
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });

  db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  const schemaPath = path.join(__dirname, "schema.sql");
  const schemaSql = fs.readFileSync(schemaPath, "utf8");
  db.exec(schemaSql);

  db.exec("PRAGMA table_info(products)");
  const columns = db.prepare("PRAGMA table_info(products)").all();
  const hasStock = columns.some(c => c.name === 'stock');
  if (!hasStock) {
    db.exec("ALTER TABLE products ADD COLUMN stock INTEGER NOT NULL DEFAULT 0");
  }
  const hasInitialStock = columns.some(c => c.name === 'initial_stock');
  if (!hasInitialStock) {
    db.exec("ALTER TABLE products ADD COLUMN initial_stock INTEGER NOT NULL DEFAULT 0");
  }

  seedDefaults(db);
  return db;
}

function getDb() {
  if (!db) initDb();
  return db;
}

function seedDefaults(dbInstance) {
  const insertCategory = dbInstance.prepare(
    "INSERT OR IGNORE INTO categories (name) VALUES (?)"
  );
  const defaults = ["Snack Time", "Dunia Mie", "Minuman"];
  const tx = dbInstance.transaction(() => {
    for (const name of defaults) insertCategory.run(name);
  });
  tx();
}

module.exports = {
  initDb,
  getDb,
  getDbPath
};

