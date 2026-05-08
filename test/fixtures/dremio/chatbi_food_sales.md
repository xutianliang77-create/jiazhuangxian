# CodeClaw Dremio Test Table: `chatbi_food_sales`

This CSV is designed for BI/data-agent testing. It intentionally makes "top by quantity" different from "top by sales amount".

## File

```text
test/fixtures/dremio/chatbi_food_sales.csv
```

## Columns

| Column | Meaning | Example |
| --- | --- | --- |
| `order_id` | order line id | `ORD-20260101-001` |
| `order_date` | order date | `2026-01-01` |
| `customer_id` | customer id | `CUST-001` |
| `item_name` | food/product name | `Bread` |
| `category` | product category | `Bakery` |
| `quantity` | sold units | `5` |
| `unit_price` | unit price | `6.00` |
| `sales_amount` | `quantity * unit_price` | `30.00` |
| `city` | city | `Shanghai` |
| `channel` | order channel | `online` |
| `store_id` | store id | `ST-001` |
| `order_status` | order status | `completed` |
| `rating` | user rating | `4.5` |

## Expected BI Checks

- Highest quantity item: `Bread`.
- Highest sales amount item: `Steak`.
- `quantity` and `sales_amount` are separate measures and should not be mixed.

Verified totals from the CSV:

| Metric | Winner | Value |
| --- | --- | ---: |
| `SUM(quantity)` | `Bread` | `138` |
| `SUM(sales_amount)` | `Steak` | `2068.00` |

## Dremio Import Notes

One simple path:

1. Upload `chatbi_food_sales.csv` into your Dremio home space or a file source.
2. Enable "extract header" / "use first row as column names".
3. Save or promote it as `chatbi_food_sales`.
4. In CodeClaw, run `SyncMetadataIndex` again so Beelink can see the new table and columns.

## Example SQL

Use the actual Dremio path after upload. For example, if the table is available as `"@x".chatbi_food_sales`:

```sql
SELECT item_name, SUM(quantity) AS total_quantity
FROM "@x".chatbi_food_sales
GROUP BY item_name
ORDER BY total_quantity DESC
LIMIT 5;
```

```sql
SELECT item_name, SUM(sales_amount) AS total_sales_amount
FROM "@x".chatbi_food_sales
GROUP BY item_name
ORDER BY total_sales_amount DESC
LIMIT 5;
```

```sql
SELECT
  item_name,
  SUM(quantity) AS total_quantity,
  SUM(sales_amount) AS total_sales_amount
FROM "@x".chatbi_food_sales
GROUP BY item_name
ORDER BY total_sales_amount DESC
LIMIT 10;
```
