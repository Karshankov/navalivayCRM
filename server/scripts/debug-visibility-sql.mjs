import { initDb, db } from '../db.js';
import { getCustomerOrderHistoryLaunchIso } from '../utils/product-reviews.js';

initDb();

const launch = getCustomerOrderHistoryLaunchIso().replace('T', ' ').replace('Z', '');
console.log('launch_param:', launch);

const rows = db
  .prepare(
    `SELECT
      order_number,
      archived,
      completed_at,
      COALESCE(archived, 0) = 0 AS unarchived,
      REPLACE(REPLACE(COALESCE(completed_at, updated_at, created_at), 'T', ' '), 'Z', '') AS norm,
      REPLACE(REPLACE(COALESCE(completed_at, updated_at, created_at), 'T', ' '), 'Z', '') >= ? AS after_launch,
      (
        COALESCE(archived, 0) = 0
        OR REPLACE(REPLACE(COALESCE(completed_at, updated_at, created_at), 'T', ' '), 'Z', '') >= ?
      ) AS passes_visibility
     FROM orders
     WHERE order_number IN (9086, 9137, 9132, 9194, 9114, 9115, 9116)`,
  )
  .all(launch, launch);

console.log(JSON.stringify(rows, null, 2));

const quai = db
  .prepare(
    `SELECT o.order_number, o.archived
     FROM orders o
     LEFT JOIN customers c ON c.id = o.customer_id
     WHERE (
       COALESCE(o.archived, 0) = 0
       OR REPLACE(REPLACE(COALESCE(o.completed_at, o.updated_at, o.created_at), 'T', ' '), 'Z', '') >= ?
     )
       AND o.status IN ('delivered', 'completed', 'cancelled')
       AND o.customer_id = ?`,
  )
  .all(launch, 'cust_1769541013594_cs5kdz');

console.log('quai_sql_rows', quai);