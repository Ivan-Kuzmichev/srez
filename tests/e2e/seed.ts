// Seeds the e2e database before the server starts: a share in the directory, so tests need no network.
import { openDb } from '../../src/db/client';
import { instruments } from '../../src/db/schema';

const db = openDb(process.env.DATABASE_PATH ?? './data/e2e.db');
db.insert(instruments)
  .values({
    kind: 'share',
    assetClass: 'stocks',
    ticker: 'SBER',
    name: 'Сбербанк',
    isin: 'RU0009029540',
    currency: 'RUB',
    lot: '1',
  })
  .onConflictDoNothing()
  .run();
db.$client.close();
