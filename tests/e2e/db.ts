import Database from 'better-sqlite3';

/** Read-only peek into the e2e database, for checking what the worker computed. */
export function e2eDb() {
  return new Database('./data/e2e.db', { readonly: true, fileMustExist: true });
}

export function positionOf(username: string, ticker: string) {
  const db = e2eDb();
  try {
    return db
      .prepare(
        `select p.quantity, p.cost_basis as costBasis, p.avg_price as avgPrice
         from positions p
         join instruments i on i.id = p.instrument_id
         join user u on u.id = p.user_id
         where u.username = ? and i.ticker = ?`,
      )
      .get(username, ticker) as { quantity: string; costBasis: string; avgPrice: string } | undefined;
  } finally {
    db.close();
  }
}
