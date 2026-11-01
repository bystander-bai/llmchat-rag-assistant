from langchain_community.document_loaders import DirectoryLoader, TextLoader
from langchain_text_splitters import RecursiveCharacterTextSplitter
from langchain_community.vectorstores import Chroma
from langchain_openai import OpenAIEmbeddings
import os
import shutil
import gc
from pathlib import Path
from uuid import uuid4
from chromadb import PersistentClient
from chromadb.config import Settings

from modules.env_utils import load_project_env, project_path, read_env_value, validate_embedding_api_key

load_project_env()

DEFAULT_EMBEDDING_BASE = "https://tokenhub.tencentmaas.com/v1"
DEFAULT_EMBEDDING_MODEL = "kinfra-text-embedding-0.6b"


# ---------------------------------------------------------------------------
# OpenAI 兼容 Embedding（默认 TokenHub 国内站）
# 供 Loader 向量化与检索使用；base_url 须以 /v1 结尾
# ---------------------------------------------------------------------------
def build_embeddings() -> OpenAIEmbeddings:
    """读取独立向量配置，构建入库与检索共用的 Embedding 客户端。"""
    api_key = read_env_value(
        "EMBEDDING_API_KEY",
        "HUNYUAN_API_KEY",
        "TOKENHUB_API_KEY",
        "OPENAI_API_KEY",
        "DASHSCOPE_API_KEY",
    )
    validate_embedding_api_key(api_key)

    base_url = (
        read_env_value("EMBEDDING_API_BASE") or DEFAULT_EMBEDDING_BASE
    ).rstrip("/")
    if base_url.endswith("/embeddings"):
        base_url = base_url[: -len("/embeddings")]
    model = read_env_value("EMBEDDING_MODEL") or DEFAULT_EMBEDDING_MODEL

    # DashScope 的批次限制更小；TokenHub 默认每批 64 条。
    is_dashscope = "dashscope" in base_url.lower()
    batch_raw = read_env_value("EMBEDDING_BATCH_SIZE") or (
        "10" if is_dashscope else "64"
    )
    try:
        batch_size = int(batch_raw)
        if batch_size <= 0:
            raise ValueError
    except ValueError as exc:
        raise ValueError("EMBEDDING_BATCH_SIZE 必须是正整数") from exc

    kwargs = {
        "api_key": api_key,
        "base_url": base_url,
        "model": model,
        "chunk_size": batch_size,
        # 直接传原始文本，兼容第三方向量服务。
        "check_embedding_ctx_length": False,
        "model_kwargs": {"encoding_format": "float"},
    }
    # TokenHub kinfra 使用固定维度；仅对支持自定义维度的 DashScope 传参。
    dims_raw = read_env_value("EMBEDDING_DIMENSIONS")
    if dims_raw and is_dashscope:
        try:
            dimensions = int(dims_raw)
            if dimensions <= 0:
                raise ValueError
        except ValueError as exc:
            raise ValueError("EMBEDDING_DIMENSIONS 必须是正整数") from exc
        kwargs["dimensions"] = dimensions

    return OpenAIEmbeddings(**kwargs)


class Loader:
    def __init__(self):
        self.persist_directory = project_path(os.getenv("PERSISTANT_STORAGE_DIR", "./db_md"))
        self.data_directory = project_path(os.getenv("DATA_DIR", "./data/md"))
        self.embedding = build_embeddings()

    # 已有库直接加载；缺库或显式重建时，递归加载资料并切块入库。
    def get_retriever(self):
        """加载或重建持久化 Chroma 向量库，返回供问答节点使用的检索器。"""
        db_exists = False
        if os.path.isdir(self.persist_directory):
            with os.scandir(self.persist_directory) as entries:
                db_exists = next(entries, None) is not None
        rebuild = os.getenv("REBUILD_VECTORSTORE", "False").strip().lower() == "true"

        if db_exists and not rebuild:
            print(f"Loading existing vectorstore from {self.persist_directory}")
            vectordb = Chroma(
                persist_directory=self.persist_directory,
                embedding_function=self.embedding,
            )
            return vectordb.as_retriever()

        print(f"Building vectorstore from markdown files in {self.data_directory} ...")
        loader = DirectoryLoader(
            self.data_directory,
            glob="**/*.md",
            loader_cls=TextLoader,
            loader_kwargs={"encoding": "utf-8"},
            show_progress=True,
        )
        documents = loader.load()
        if not documents:
            raise FileNotFoundError(
                f"No .md files found in {self.data_directory}. "
                "请将知识 Markdown 放入该目录后重建向量库。"
            )
        print(f"Loaded {len(documents)} documents")

        text_splitter = RecursiveCharacterTextSplitter(
            chunk_size=800, chunk_overlap=120
        )
        texts = text_splitter.split_documents(documents)
        texts = [text for text in texts if (text.page_content or "").strip()]
        if not texts:
            raise ValueError(
                f"Markdown files in {self.data_directory} contain no usable text. "
                "知识资料均为空，请补充正文后重建向量库。"
            )

        # Build beside the active database first. A failed embedding request
        # must leave the last known-good database available for service restart.
        persist_path = Path(self.persist_directory)
        build_path = Path(f"{self.persist_directory}.building-{uuid4().hex}")
        backup_path = Path(f"{self.persist_directory}.backup-{uuid4().hex}")
        print(f"Split into {len(texts)} chunks, embedding & persisting...")
        vectordb = None
        try:
            # Own the staging client explicitly so every path releases its
            # SQLite handles before cleanup or a directory swap on Windows.
            client = PersistentClient(
                path=str(build_path), settings=Settings(anonymized_telemetry=False)
            )
            built_db = None
            try:
                built_db = Chroma.from_documents(
                    documents=texts,
                    embedding=self.embedding,
                    client=client,
                    persist_directory=str(build_path),
                )
                if len(built_db.get()["ids"]) != len(texts):
                    raise RuntimeError("向量库构建校验失败，已保留旧库。")
            finally:
                client.close()
                if built_db is not None:
                    # Chroma keeps the client and collection on the wrapper
                    # even after close; clear both references before rename.
                    built_db._collection = None
                    built_db._client = None
                del built_db
                del client
                gc.collect()
            if persist_path.exists():
                persist_path.rename(backup_path)
            try:
                build_path.rename(persist_path)
                vectordb = Chroma(
                    persist_directory=self.persist_directory,
                    embedding_function=self.embedding,
                )
                if len(vectordb.get()["ids"]) != len(texts):
                    raise RuntimeError("切换后的向量库校验失败。")
            except Exception:
                if vectordb is not None:
                    vectordb._client.close()
                    vectordb._collection = None
                    vectordb._client = None
                    vectordb = None
                    gc.collect()
                if persist_path.exists():
                    persist_path.rename(build_path)
                if backup_path.exists() and not persist_path.exists():
                    backup_path.rename(persist_path)
                raise
            if backup_path.exists():
                shutil.rmtree(backup_path, ignore_errors=True)
        except Exception:
            # A partial temporary build is disposable; the active DB has not
            # been touched unless the final swap had already begun.
            if build_path.exists():
                shutil.rmtree(build_path, ignore_errors=True)
            raise
        print("Vectorstore ready.")
        return vectordb.as_retriever()
