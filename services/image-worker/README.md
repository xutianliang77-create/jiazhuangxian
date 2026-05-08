# image-worker

Python 图像预处理服务，负责验证版 DICOM/超声图像处理。

验证版定位：

- 作为 CodeClaw MCP/HTTP wrapper 后面的图像处理 worker。
- Agent 不直接读取 DICOM 或运行 OpenCV；只调用本服务接口。
- 原始图像、预览图和 model-ready image 都落在本地 `artifact://` 映射目录。
- 缺少 `pydicom`/`opencv` 等医学图像依赖时，服务仍可启动并返回结构化错误。

当前接口：

| 方法 | 路径 | 说明 |
|---|---|---|
| `GET` | `/health` | 服务健康检查与依赖状态 |
| `POST` | `/image/v1/parse-dicom` | DICOM metadata 解析 |
| `POST` | `/image/v1/deidentify-dicom` | DICOM PHI metadata 脱敏 |
| `POST` | `/image/v1/render-preview` | PNG/JPEG 预览图生成 |
| `POST` | `/image/v1/preprocess-ultrasound` | 灰阶/归一化 model-ready image |
| `POST` | `/image/v1/extract-calibration` | pixel spacing / 标定提取 |
| `POST` | `/image/v1/image-quality-check` | 图像质量检测 |

计划能力补齐：

- DICOM 解析：`pydicom`
- PHI metadata 脱敏
- PNG/JPEG 预览生成
- OpenCV 图像增强与 model-ready image 生成
- pixel spacing / 超声标定提取
- 图像质量检测

CodeClaw/Agent 侧只通过 MCP/HTTP 工具调用该服务。

## 本地启动

```bash
cd services/image-worker
python3 -m pip install -r requirements.txt
JZX_ARTIFACT_ROOT=../../data/artifacts python3 -m app
```

默认监听：

```text
http://127.0.0.1:8765
```

## 请求示例

```bash
curl -s http://127.0.0.1:8765/health
```

```bash
curl -s http://127.0.0.1:8765/image/v1/image-quality-check \
  -H 'content-type: application/json' \
  -d '{
    "study_id": "S1",
    "image_id": "IMG1",
    "image_uri": "artifact://raw/S1/IMG1.png",
    "metadata": {},
    "trace_id": "TRACE1"
  }'
```

## 测试

```bash
python3 -m unittest discover services/image-worker/tests
```
