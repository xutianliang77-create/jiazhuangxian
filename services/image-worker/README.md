# image-worker

Python 图像预处理服务，负责验证版 DICOM/超声图像处理。

计划能力：

- DICOM 解析：`pydicom`
- PHI metadata 脱敏
- PNG/JPEG 预览生成
- OpenCV 图像增强与 model-ready image 生成
- pixel spacing / 超声标定提取
- 图像质量检测

CodeClaw/Agent 侧只通过 MCP/HTTP 工具调用该服务。
