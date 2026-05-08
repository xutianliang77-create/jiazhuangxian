"""
DuckDB REST API 服务端
提供与 Beelink 平台兼容的接口
"""

import duckdb
import json
import os
import pandas as pd
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs
from datetime import datetime

DB_PATH = os.environ.get('DUCKDB_DB', '/data/chatbi.duckdb')

def init_db():
    """初始化数据库"""
    con = duckdb.connect(DB_PATH)
    with open('/app/init.sql', 'r') as f:
        con.execute(f.read())
    con.close()
    print("Database initialized successfully")

# 启动时初始化
init_db()

class DuckDBHandler(BaseHTTPRequestHandler):

    def get_db_connection(self):
        return duckdb.connect(DB_PATH)

    def do_GET(self):
        parsed = urlparse(self.path)

        if parsed.path == '/api/v3/catalog':
            self.handle_catalog()
        elif parsed.path.startswith('/api/v3/query/preview'):
            params = parse_qs(parsed.query)
            sql = params.get('sql', [''])[0]
            limit = int(params.get('limit', '50')[0])
            self.handle_preview(sql, limit)
        else:
            self.send_error(404)

    def do_POST(self):
        parsed = urlparse(self.path)
        content_length = int(self.headers.get('Content-Length', 0))
        body = self.rfile.read(content_length)

        try:
            data = json.loads(body)
        except:
            self.send_error(400)
            return

        if parsed.path == '/apiv2/login':
            self.handle_login(data)
        elif parsed.path == '/api/v3/query/preview':
            sql = data.get('sql', '')
            limit = data.get('limit', 50)
            self.handle_preview(sql, limit)
        elif parsed.path == '/api/v3/query/export':
            sql = data.get('sql', '')
            limit = data.get('limit', 5000)
            self.handle_export(sql, limit)
        else:
            self.send_error(404)

    def handle_catalog(self):
        """返回目录列表"""
        con = self.get_db_connection()
        tables = con.execute("SHOW TABLES").fetchall()

        response = {
            "data": [
                {
                    "name": "x",
                    "type": "space",
                    "children": [
                        {
                            "name": t[0],
                            "type": "table",
                            "path": ["x", t[0]]
                        } for t in tables if 'legacy' not in t[0]
                    ]
                }
            ]
        }

        self.send_json(response)
        con.close()

    def handle_login(self, data):
        """模拟登录，返回 token"""
        response = {
            "token": "local-docker-token",
            "user": data.get('userName', 'admin')
        }
        self.send_json(response)

    def handle_preview(self, sql, limit):
        """执行 SQL 预览"""
        try:
            con = self.get_db_connection()
            result = con.execute(f"{sql} LIMIT {limit}").fetchdf()
            columns = [
                {"name": col, "type": str(result[col].dtype)}
                for col in result.columns
            ]
            rows = result.to_dict('records')
            con.close()

            response = {
                "columns": columns,
                "rows": rows,
                "rowCount": len(rows)
            }
            self.send_json(response)
        except Exception as e:
            self.send_json({"error": str(e)}, status=500)

    def handle_export(self, sql, limit):
        """执行 SQL 导出"""
        try:
            con = self.get_db_connection()
            result = con.execute(f"{sql} LIMIT {limit}").fetchdf()
            columns = [
                {"name": col, "type": str(result[col].dtype)}
                for col in result.columns
            ]
            rows = result.to_dict('records')
            con.close()

            response = {
                "columns": columns,
                "rows": rows,
                "rowCount": len(rows),
                "truncated": len(rows) >= limit
            }
            self.send_json(response)
        except Exception as e:
            self.send_json({"error": str(e)}, status=500)

    def send_json(self, data, status=200):
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        self.wfile.write(json.dumps(data, ensure_ascii=False, default=str).encode())

    def log_message(self, format, *args):
        print(f"[DuckDB API] {args[0]}")

if __name__ == '__main__':
    server = HTTPServer(('0.0.0.0', 8080), DuckDBHandler)
    print("DuckDB REST API running on http://0.0.0.0:8080")
    server.serve_forever()