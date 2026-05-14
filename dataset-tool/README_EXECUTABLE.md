# 甲状腺数据集整理工具：可执行版

## 给使用者

拿到 `ThyroidDatasetTool.exe` 后，直接双击打开。

如果还没有 EXE，也可以双击 `run_gui_windows.bat`。它会自动创建本地 Python 环境、安装依赖并打开图形界面。

使用步骤：

1. 点击“原始资料文件夹”的“选择”，选医院硬盘里的原始资料目录。
2. 点击“脱敏数据集保存目录”的“选择”，选一个新的空目录。
3. 保持“启用基础脱敏”和“启用病例身份关联”勾选。
4. 点击“开始整理数据集”。
5. 完成后点击“打开保存目录”，抽查图片、视频、报告和 `metadata/warnings.jsonl`。

安全规则：

- 原始资料文件夹只读，不会被修改。
- 脱敏后的文件保存在新的数据集目录。
- 默认不会把原始文件路径、姓名、病历号写入数据集清单。
- 无法安全脱敏的文件不会复制进新数据集目录，只会写入 warning。

## 给打包人员

Windows 打包：

1. 在 Windows 电脑安装 Python 3.9 或更新版本。
2. 进入 `dataset-tool` 目录。
3. 双击 `build_windows_exe.bat`。
4. 打包成功后，可执行文件在 `dataset-tool/dist/ThyroidDatasetTool.exe`。

视频脱敏需要 Windows 电脑安装 `ffmpeg`，否则图片、报告、DICOM tag 仍可处理，但视频会在 warning 中标记失败。

## 自动启动配置

如果医院电脑固定使用同一批目录，可以把 `dataset_tool_auto_run.example.json` 复制为：

```text
dataset_tool_auto_run.json
```

放在 `ThyroidDatasetTool.exe` 同一个目录，然后修改里面的路径。如果把：

```json
"auto_start": true
```

改为 `true`，双击 EXE 后会自动开始整理。
