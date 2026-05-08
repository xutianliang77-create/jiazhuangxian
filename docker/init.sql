-- Food Sales 示例数据初始化

CREATE TABLE IF NOT EXISTS chatbi_food_sales (
    order_id TEXT,
    order_date TEXT,
    customer_id TEXT,
    item_name TEXT,
    category TEXT,
    quantity INTEGER,
    unit_price DECIMAL(10,2),
    sales_amount DECIMAL(10,2),
    city TEXT,
    channel TEXT,
    store_id TEXT,
    order_status TEXT,
    rating DECIMAL(3,1)
);

INSERT INTO chatbi_food_sales VALUES
('ORD-20260101-001', '2026-01-01', 'CUST-001', 'Bread', 'Bakery', 5, 6.00, 30.00, 'Shanghai', 'offline', 'ST-001', 'completed', 4.5),
('ORD-20260101-002', '2026-01-01', 'CUST-002', 'Banana Shake', 'Drink', 2, 18.00, 36.00, 'Shanghai', 'online', 'ST-001', 'completed', 4.7),
('ORD-20260101-003', '2026-01-01', 'CUST-003', 'Truffle Pasta', 'Main', 1, 128.00, 128.00, 'Beijing', 'offline', 'ST-002', 'completed', 4.8),
('ORD-20260101-004', '2026-01-01', 'CUST-004', 'Pizza', 'Main', 2, 58.00, 116.00, 'Beijing', 'online', 'ST-002', 'completed', 4.4),
('ORD-20260101-005', '2026-01-01', 'CUST-005', 'Coffee', 'Drink', 3, 22.00, 66.00, 'Shanghai', 'offline', 'ST-003', 'completed', 4.2),
('ORD-20260102-006', '2026-01-02', 'CUST-001', 'Bread', 'Bakery', 8, 6.00, 48.00, 'Shanghai', 'offline', 'ST-001', 'completed', 4.6),
('ORD-20260102-007', '2026-01-02', 'CUST-006', 'Croissant', 'Bakery', 4, 15.00, 60.00, 'Guangzhou', 'online', 'ST-004', 'completed', 4.3),
('ORD-20260102-008', '2026-01-02', 'CUST-007', 'Steak', 'Main', 1, 198.00, 198.00, 'Shanghai', 'offline', 'ST-001', 'completed', 4.9),
('ORD-20260102-009', '2026-01-02', 'CUST-008', 'Mango Smoothie', 'Drink', 3, 25.00, 75.00, 'Beijing', 'online', 'ST-002', 'completed', 4.5),
('ORD-20260102-010', '2026-01-02', 'CUST-003', 'Truffle Pasta', 'Main', 2, 128.00, 256.00, 'Beijing', 'offline', 'ST-002', 'completed', 4.8),
('ORD-20260103-011', '2026-01-03', 'CUST-009', 'Salad', 'Main', 2, 45.00, 90.00, 'Shanghai', 'online', 'ST-003', 'completed', 4.1),
('ORD-20260103-012', '2026-01-03', 'CUST-010', 'Coffee', 'Drink', 5, 22.00, 110.00, 'Guangzhou', 'offline', 'ST-004', 'completed', 4.4),
('ORD-20260103-013', '2026-01-03', 'CUST-002', 'Banana Shake', 'Drink', 4, 18.00, 72.00, 'Shanghai', 'online', 'ST-001', 'completed', 4.7),
('ORD-20260103-014', '2026-01-03', 'CUST-011', 'Dim Sum', 'Main', 3, 68.00, 204.00, 'Shanghai', 'offline', 'ST-001', 'completed', 4.6),
('ORD-20260103-015', '2026-01-03', 'CUST-005', 'Bread', 'Bakery', 6, 6.00, 36.00, 'Beijing', 'online', 'ST-002', 'completed', 4.3);

-- 创建视图兼容原始列名映射 (A, B, C, D...)
CREATE OR REPLACE VIEW chatbi_food_sales_legacy AS
SELECT
    order_id AS "A",
    order_date AS "B",
    customer_id AS "C",
    item_name AS "D",
    category AS "E",
    quantity AS "F",
    unit_price AS "G",
    sales_amount AS "H",
    city AS "I",
    channel AS "J",
    store_id AS "K",
    order_status AS "L",
    rating AS "M"
FROM chatbi_food_sales;