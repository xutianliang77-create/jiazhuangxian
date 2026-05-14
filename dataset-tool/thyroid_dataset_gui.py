#!/usr/bin/env python3
from __future__ import annotations

import json
import os
import queue
import secrets
import subprocess
import sys
import threading
import traceback
from datetime import datetime
from pathlib import Path
from tkinter import filedialog, messagebox, ttk
import tkinter as tk

import thyroid_dataset_builder as builder


APP_TITLE = "甲状腺数据集整理工具"
AUTO_CONFIG_NAMES = ["dataset_tool_auto_run.json", "dataset_tool_config.json"]


class DatasetToolApp:
    def __init__(self, root: tk.Tk) -> None:
        self.root = root
        self.root.title(APP_TITLE)
        self.root.geometry("820x680")
        self.root.minsize(760, 620)
        self.messages: queue.Queue[tuple[str, object]] = queue.Queue()
        self.worker: threading.Thread | None = None
        self.last_output_dir: Path | None = None

        config = load_auto_config()
        self.source_var = tk.StringVar(value=str(config.get("source_root", "")))
        self.output_var = tk.StringVar(value=str(config.get("output_dir", default_output_dir())))
        self.dataset_id_var = tk.StringVar(value=str(config.get("dataset_id", "")))
        self.identity_var = tk.BooleanVar(value=bool(config.get("identity_linkage", True)))
        self.deidentify_var = tk.BooleanVar(value=bool(config.get("deidentify", True)))
        self.overwrite_var = tk.BooleanVar(value=bool(config.get("overwrite", False)))
        self.status_var = tk.StringVar(value="请选择原始资料文件夹和保存目录。")
        self.auto_start = bool(config.get("auto_start", False))
        self.config_sensitive_terms = config.get("sensitive_terms", [])

        self.build_ui()
        self.root.after(150, self.poll_messages)
        if self.auto_start and self.source_var.get() and self.output_var.get():
            self.root.after(600, self.start_build)

    def build_ui(self) -> None:
        outer = ttk.Frame(self.root, padding=18)
        outer.pack(fill=tk.BOTH, expand=True)

        title = ttk.Label(outer, text=APP_TITLE, font=("", 18, "bold"))
        title.pack(anchor=tk.W)
        subtitle = ttk.Label(
            outer,
            text="原始文件只读不修改；脱敏后的副本会保存到新的数据集目录。",
            foreground="#555555",
        )
        subtitle.pack(anchor=tk.W, pady=(4, 16))

        form = ttk.Frame(outer)
        form.pack(fill=tk.X)
        self.add_folder_row(form, 0, "原始资料文件夹", self.source_var, self.choose_source)
        self.add_folder_row(form, 1, "脱敏数据集保存目录", self.output_var, self.choose_output)

        ttk.Label(form, text="数据集名称").grid(row=2, column=0, sticky=tk.W, pady=7)
        ttk.Entry(form, textvariable=self.dataset_id_var).grid(row=2, column=1, sticky=tk.EW, padx=(10, 10), pady=7)
        ttk.Label(form, text="不填则使用保存目录名称").grid(row=2, column=2, sticky=tk.W, pady=7)
        form.columnconfigure(1, weight=1)

        options = ttk.LabelFrame(outer, text="处理选项", padding=12)
        options.pack(fill=tk.X, pady=(14, 10))
        ttk.Checkbutton(options, text="启用基础脱敏（推荐）", variable=self.deidentify_var).grid(row=0, column=0, sticky=tk.W, padx=(0, 20))
        ttk.Checkbutton(options, text="启用病例身份关联（推荐）", variable=self.identity_var).grid(row=0, column=1, sticky=tk.W, padx=(0, 20))
        ttk.Checkbutton(options, text="覆盖已有保存目录", variable=self.overwrite_var).grid(row=0, column=2, sticky=tk.W)

        terms_frame = ttk.LabelFrame(outer, text="额外敏感词，可不填", padding=12)
        terms_frame.pack(fill=tk.BOTH, expand=False, pady=(4, 10))
        ttk.Label(terms_frame, text="每行一个姓名、手机号、身份证号或其他需要替换的文字。工具也会自动使用报告/DICOM 中识别到的姓名和编号。").pack(anchor=tk.W)
        self.terms_text = tk.Text(terms_frame, height=5, wrap=tk.WORD)
        self.terms_text.pack(fill=tk.BOTH, expand=True, pady=(8, 0))
        if isinstance(self.config_sensitive_terms, list):
            self.terms_text.insert("1.0", "\n".join(str(item) for item in self.config_sensitive_terms if str(item).strip()))

        actions = ttk.Frame(outer)
        actions.pack(fill=tk.X, pady=(4, 8))
        self.start_button = ttk.Button(actions, text="开始整理数据集", command=self.start_build)
        self.start_button.pack(side=tk.LEFT)
        self.open_button = ttk.Button(actions, text="打开保存目录", command=self.open_output_dir, state=tk.DISABLED)
        self.open_button.pack(side=tk.LEFT, padx=(10, 0))
        ttk.Label(actions, textvariable=self.status_var, foreground="#2255aa").pack(side=tk.LEFT, padx=(18, 0))

        log_frame = ttk.LabelFrame(outer, text="运行日志", padding=8)
        log_frame.pack(fill=tk.BOTH, expand=True)
        self.log_text = tk.Text(log_frame, height=12, wrap=tk.WORD, state=tk.DISABLED)
        self.log_text.pack(side=tk.LEFT, fill=tk.BOTH, expand=True)
        scroll = ttk.Scrollbar(log_frame, command=self.log_text.yview)
        scroll.pack(side=tk.RIGHT, fill=tk.Y)
        self.log_text.configure(yscrollcommand=scroll.set)

        self.log("准备就绪。")
        self.log("提示：第一次使用建议先用少量病例试跑，确认脱敏效果后再整理整盘数据。")

    def add_folder_row(self, parent: ttk.Frame, row: int, label: str, var: tk.StringVar, command) -> None:
        ttk.Label(parent, text=label).grid(row=row, column=0, sticky=tk.W, pady=7)
        ttk.Entry(parent, textvariable=var).grid(row=row, column=1, sticky=tk.EW, padx=(10, 10), pady=7)
        ttk.Button(parent, text="选择", command=command).grid(row=row, column=2, sticky=tk.E, pady=7)

    def choose_source(self) -> None:
        folder = filedialog.askdirectory(title="选择原始资料文件夹")
        if folder:
            self.source_var.set(folder)
            if not self.dataset_id_var.get().strip():
                self.dataset_id_var.set(safe_dataset_name(Path(folder).name))

    def choose_output(self) -> None:
        folder = filedialog.askdirectory(title="选择脱敏数据集保存目录")
        if folder:
            self.output_var.set(folder)
            if not self.dataset_id_var.get().strip():
                self.dataset_id_var.set(safe_dataset_name(Path(folder).name))

    def start_build(self) -> None:
        if self.worker and self.worker.is_alive():
            messagebox.showinfo(APP_TITLE, "正在整理中，请等待完成。")
            return
        try:
            options = self.make_options()
        except ValueError as exc:
            messagebox.showerror(APP_TITLE, str(exc))
            return
        if options.deidentify == "off":
            confirmed = messagebox.askyesno(
                APP_TITLE,
                "你关闭了基础脱敏。这样可能把原始文件复制到保存目录。\n\n确认只在院内本机盘点使用，并继续吗？",
            )
            if not confirmed:
                return

        if options.output_dir.exists() and any(options.output_dir.iterdir()) and not options.overwrite:
            messagebox.showerror(APP_TITLE, "保存目录已经有文件。请换一个空目录，或勾选“覆盖已有保存目录”。")
            return

        self.last_output_dir = options.output_dir
        self.start_button.configure(state=tk.DISABLED)
        self.open_button.configure(state=tk.DISABLED)
        self.status_var.set("正在整理，请不要关闭窗口。")
        self.clear_log()
        self.log("开始整理数据集。")
        self.log(f"原始资料：{options.source_root}")
        self.log(f"保存目录：{options.output_dir}")
        self.worker = threading.Thread(target=self.run_build, args=(options,), daemon=True)
        self.worker.start()

    def make_options(self) -> builder.BuildOptions:
        source_root = Path(self.source_var.get()).expanduser()
        output_dir = Path(self.output_var.get()).expanduser()
        if not source_root.is_dir():
            raise ValueError("请选择正确的原始资料文件夹。")
        if output_dir.exists() and not output_dir.is_dir():
            raise ValueError("保存位置必须是文件夹，不能是一个文件。")
        if source_root.resolve() == output_dir.resolve():
            raise ValueError("保存目录不能和原始资料文件夹相同。请新建或选择另一个目录。")
        dataset_id = builder.safe_id(self.dataset_id_var.get().strip() or output_dir.name or "thyroid-dataset")
        sensitive_terms = [line.strip() for line in self.terms_text.get("1.0", tk.END).splitlines() if line.strip()]
        linkage_salt = get_or_create_linkage_salt() if self.identity_var.get() else None
        return builder.BuildOptions(
            source_root=source_root.resolve(),
            output_dir=output_dir.resolve(),
            dataset_id=dataset_id,
            case_mode="auto",
            copy_mode="copy",
            case_regex=None,
            overwrite=self.overwrite_var.get(),
            extract_labelme_image_data=True,
            deidentify="basic" if self.deidentify_var.get() else "off",
            redact_regions=builder.DEFAULT_REDACT_REGIONS.copy(),
            sensitive_terms=sensitive_terms,
            linkage_mode="identity" if self.identity_var.get() else "auto",
            linkage_salt=linkage_salt,
            include_source_paths=False,
        )

    def run_build(self, options: builder.BuildOptions) -> None:
        try:
            summary = builder.build_dataset(options)
            warning_count = count_jsonl(options.output_dir / "metadata" / "warnings.jsonl")
            self.messages.put(("done", {"summary": summary, "warning_count": warning_count}))
        except Exception:
            self.messages.put(("error", traceback.format_exc()))

    def poll_messages(self) -> None:
        while True:
            try:
                kind, payload = self.messages.get_nowait()
            except queue.Empty:
                break
            if kind == "done":
                self.handle_done(payload)
            elif kind == "error":
                self.handle_error(str(payload))
        self.root.after(150, self.poll_messages)

    def handle_done(self, payload: object) -> None:
        data = payload if isinstance(payload, dict) else {}
        summary = data.get("summary", {}) if isinstance(data.get("summary"), dict) else {}
        warning_count = int(data.get("warning_count", 0) or 0)
        self.log("")
        self.log("整理完成。")
        self.log(f"病例数：{summary.get('case_count', 0)}")
        self.log(f"文件数：{summary.get('file_count', 0)}")
        self.log(f"需要复核的问题数：{warning_count}")
        self.log("请先抽查输出图片/视频边角、报告内容和 metadata/warnings.jsonl。")
        self.status_var.set("已完成。")
        self.start_button.configure(state=tk.NORMAL)
        self.open_button.configure(state=tk.NORMAL)
        messagebox.showinfo(APP_TITLE, "数据集整理完成。建议先打开保存目录抽查脱敏效果。")

    def handle_error(self, detail: str) -> None:
        self.log("")
        self.log("整理失败：")
        self.log(detail)
        self.status_var.set("整理失败，请查看日志。")
        self.start_button.configure(state=tk.NORMAL)
        self.open_button.configure(state=tk.NORMAL if self.last_output_dir else tk.DISABLED)
        messagebox.showerror(APP_TITLE, "整理失败。请把运行日志发给开发人员查看。")

    def open_output_dir(self) -> None:
        if not self.last_output_dir:
            self.last_output_dir = Path(self.output_var.get()).expanduser()
        open_folder(self.last_output_dir)

    def clear_log(self) -> None:
        self.log_text.configure(state=tk.NORMAL)
        self.log_text.delete("1.0", tk.END)
        self.log_text.configure(state=tk.DISABLED)

    def log(self, message: str) -> None:
        self.log_text.configure(state=tk.NORMAL)
        self.log_text.insert(tk.END, f"{timestamp()}  {message}\n")
        self.log_text.see(tk.END)
        self.log_text.configure(state=tk.DISABLED)


def timestamp() -> str:
    return datetime.now().strftime("%H:%M:%S")


def app_dir() -> Path:
    if getattr(sys, "frozen", False):
        return Path(sys.executable).resolve().parent
    return Path(__file__).resolve().parent


def app_data_dir() -> Path:
    if os.name == "nt":
        base = Path(os.environ.get("APPDATA", str(Path.home() / "AppData" / "Roaming")))
        return base / "ThyroidDatasetTool"
    if sys.platform == "darwin":
        return Path.home() / "Library" / "Application Support" / "ThyroidDatasetTool"
    return Path(os.environ.get("XDG_CONFIG_HOME", str(Path.home() / ".config"))) / "ThyroidDatasetTool"


def get_or_create_linkage_salt() -> str:
    directory = app_data_dir()
    directory.mkdir(parents=True, exist_ok=True)
    path = directory / "dataset-linkage-salt.txt"
    if path.exists():
        value = path.read_text(encoding="utf-8").strip()
        if value:
            return value
    value = secrets.token_hex(32)
    path.write_text(value, encoding="utf-8")
    try:
        path.chmod(0o600)
    except OSError:
        pass
    return value


def default_output_dir() -> Path:
    stamp = datetime.now().strftime("%Y%m%d-%H%M")
    return Path.home() / "Documents" / "甲状腺脱敏数据集" / f"thyroid-dataset-{stamp}"


def load_auto_config() -> dict:
    for name in AUTO_CONFIG_NAMES:
        path = app_dir() / name
        if not path.is_file():
            continue
        try:
            value = json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            continue
        if isinstance(value, dict):
            return value
    return {}


def count_jsonl(path: Path) -> int:
    if not path.is_file():
        return 0
    return sum(1 for line in path.read_text(encoding="utf-8").splitlines() if line.strip())


def open_folder(path: Path) -> None:
    path = path.expanduser().resolve()
    if os.name == "nt":
        os.startfile(str(path))  # type: ignore[attr-defined]
    elif sys.platform == "darwin":
        subprocess.run(["open", str(path)], check=False)
    else:
        subprocess.run(["xdg-open", str(path)], check=False)


def safe_dataset_name(value: str) -> str:
    return builder.safe_id(value) or "thyroid-dataset"


def main() -> None:
    root = tk.Tk()
    try:
        ttk.Style().theme_use("clam")
    except tk.TclError:
        pass
    DatasetToolApp(root)
    root.mainloop()


if __name__ == "__main__":
    main()
