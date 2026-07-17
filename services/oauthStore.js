const DatabaseService = require('./database');

class OAuthStore {
  constructor() {
    // Instantiate the DatabaseService so we have a live pool instance
    this.db = new DatabaseService();
    this._initPromise = null;
  }

  async _ensureTable() {
    if (!this._initPromise) {
      this._initPromise = (async () => {
        const createSql = `
          CREATE TABLE IF NOT EXISTS oauth_store (
            key TEXT PRIMARY KEY,
            data JSONB NOT NULL,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
          );
        `;
        if (!this.db || !this.db.pool) {
          throw new Error('OAuthStore database is not initialized (pool missing)');
        }
        const client = await this.db.pool.connect();
        try {
          await client.query(createSql);
        } finally {
          client.release();
        }
      })();
    }
    return this._initPromise;
  }

  async set(key, data) {
    await this._ensureTable();
    const upsert = `
      INSERT INTO oauth_store (key, data, updated_at)
      VALUES ($1, $2, NOW())
      ON CONFLICT (key)
      DO UPDATE SET data = EXCLUDED.data, updated_at = NOW();
    `;
    const client = await this.db.pool.connect();
    try {
      await client.query(upsert, [key, data]);
    } finally {
      client.release();
    }
  }

  async get(key) {
    await this._ensureTable();
    const sel = `SELECT data FROM oauth_store WHERE key = $1`;
    const client = await this.db.pool.connect();
    try {
      const res = await client.query(sel, [key]);
      return res.rows[0]?.data || null;
    } finally {
      client.release();
    }
  }

  async delete(key) {
    await this._ensureTable();
    const del = `DELETE FROM oauth_store WHERE key = $1`;
    const client = await this.db.pool.connect();
    try {
      await client.query(del, [key]);
    } finally {
      client.release();
    }
  }
}

module.exports = new OAuthStore();
