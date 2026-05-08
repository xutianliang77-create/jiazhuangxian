# CodeClaw Golden BI Fixture

This fixture is for real Beelink/Dremio golden smoke tests. It is intentionally small, deterministic, and join-oriented.

## Files

```text
test/fixtures/dremio/codeclaw_golden_customers.csv
test/fixtures/dremio/codeclaw_golden_orders.csv
```

## Suggested Dremio Table Names

Upload both CSV files with header extraction enabled, then save or promote them as:

```text
@xu.codeclaw_golden_customers
@xu.codeclaw_golden_orders
```

If your home space is not `@xu`, keep the table names and adjust only the leading space, for example:

```text
@xutianliang.codeclaw_golden_customers
@xutianliang.codeclaw_golden_orders
```

After upload, run `SyncMetadataIndex` from CodeClaw/Beelink so local `metadata.db`, `semantic-layer.json`, and `glossary.md` are refreshed.

## Column Semantics

### `codeclaw_golden_customers`

| Column | Meaning |
| --- | --- |
| `customer_id` | Join key to orders |
| `gender_code` | `F`, `M`, or `U` |
| `gender_label` | `女性`, `男性`, or `未知` |
| `city` | Customer city |
| `member_level` | Membership level |

### `codeclaw_golden_orders`

| Column | Meaning |
| --- | --- |
| `order_id` | Order line id |
| `order_date` | Order date |
| `customer_id` | Join key to customers |
| `item_name` | Product name |
| `category` | Product category |
| `quantity` | Sold units |
| `unit_price` | Unit price |
| `sales_amount` | `quantity * unit_price` |
| `order_status` | `completed` rows count as valid shopping rows; `canceled` rows must be excluded from shopping metrics |

## Golden Answers

Unless the user explicitly says otherwise, shopping metrics should use `order_status = 'completed'`.

| Question | Expected Answer |
| --- | --- |
| 女性购物有多少人，金额一共多少？ | `female_shoppers = 5`, `female_sales_amount = 1110.00` |
| 男性购物有多少人，金额一共多少？ | `male_shoppers = 4`, `male_sales_amount = 1082.00` |
| 哪个商品销量最高？ | `Bread`, `SUM(quantity) = 38` |
| 哪个商品销售额最高？ | `Steak`, `SUM(sales_amount) = 1128.00` |
| 女性注册用户有多少？ | `6` |
| 女性购物用户和女性注册用户有什么区别？ | registered female users = `6`; completed-order female shoppers = `5`; `C006` only has a canceled order |

## Reference SQL

Female shoppers and amount:

```sql
SELECT
  COUNT(DISTINCT c.customer_id) AS female_shoppers,
  SUM(o.sales_amount) AS female_sales_amount
FROM "@xu".codeclaw_golden_customers AS c
JOIN "@xu".codeclaw_golden_orders AS o
  ON c.customer_id = o.customer_id
WHERE c.gender_label = '女性'
  AND o.order_status = 'completed';
```

Top quantity product:

```sql
SELECT
  item_name,
  SUM(quantity) AS total_quantity
FROM "@xu".codeclaw_golden_orders
WHERE order_status = 'completed'
GROUP BY item_name
ORDER BY total_quantity DESC
LIMIT 1;
```

Top sales amount product:

```sql
SELECT
  item_name,
  SUM(sales_amount) AS total_sales_amount
FROM "@xu".codeclaw_golden_orders
WHERE order_status = 'completed'
GROUP BY item_name
ORDER BY total_sales_amount DESC
LIMIT 1;
```
