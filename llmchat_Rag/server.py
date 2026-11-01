# ---------------------------------------------------------------------------
# FastAPI：端口默认 14052，给实训三「RAG 模式」对接
# /health、/chat/reset、POST /chat 已实现（调 rag_app.ask）
# ---------------------------------------------------------------------------
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from typing import Optional
from uuid import uuid4
from threading import Lock
from contextlib import asynccontextmanager
import logging
import os

from modules.rag_app import ask, get_graph, new_message_history
from modules.structured_output import ModelResponseError

@asynccontextmanager
async def lifespan(app: FastAPI):
    get_graph()
    yield


app = FastAPI(title="LangGraphRAG API", version="1.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 多轮会话：session_id → message_history（进程内内存，重启清空）
_sessions: dict[str, list] = {}
# 状态图复用同一个 Nodes（含可变重试计数器），问答与重置按顺序执行。
_chat_lock = Lock()
logger = logging.getLogger(__name__)


class ChatRequest(BaseModel):
    question: str = Field(..., min_length=1, description="User question")
    session_id: Optional[str] = Field(
        None, description="Optional session id for multi-turn chat"
    )
    regenerate: bool = Field(False, description="Replace the last successful turn")


class ChatResponse(BaseModel):
    session_id: str
    answer: str
    sources: list
    steps: list


@app.get("/")
def root():
    """服务探活说明（前端请用实训三 RAG 模式，或调用下方 API）。"""
    return {
        "service": "LangGraphRAG",
        "status": "ok",
        "health": "/health",
        "chat": "POST /chat",
        "reset": "POST /chat/reset",
        "note": "UI 请使用实训三「RAG 模式」对接本服务",
    }


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/chat", response_model=ChatResponse)
def chat(req: ChatRequest):
    """执行一轮问答；仅在成功后保存会话历史，失败请求可重试。"""
    session_id = req.session_id or str(uuid4())
    try:
        with _chat_lock:
            if req.regenerate and session_id not in _sessions:
                raise HTTPException(status_code=409, detail="会话已失效，无法重新生成，请开启新对话。")
            history = (
                list(_sessions[session_id])
                if session_id in _sessions else new_message_history()
            )
            if req.regenerate:
                # ask stores one user/assistant pair after the initial marker.
                # Regenerate from the prefix, and commit only on success.
                if len(history) < 3 or history[-2] != f"msg number [{len(history) - 2}] user : {req.question.strip()}":
                    raise HTTPException(status_code=409, detail="只能重新生成当前会话的最后一轮，请刷新后重试。")
                history = history[:-2]
            try:
                result = ask(req.question, history)
            except ModelResponseError as exc:
                logger.exception("模型结构化输出失败")
                raise HTTPException(
                    status_code=503,
                    detail="模型暂时未返回有效的判断结果，请稍后重试。",
                ) from exc
            # UnicodeEncodeError 也是 ValueError，必须先处理，避免返回密钥内容。
            except UnicodeEncodeError as exc:
                raise HTTPException(
                    status_code=400,
                    detail="密钥编码异常，请检查 .env 中的问答与 Embedding API Key，"
                           "只填写真实密钥，不要包含中文占位说明。",
                ) from exc
            except ValueError as exc:
                raise HTTPException(status_code=400, detail=str(exc)) from exc

            response = ChatResponse(
                session_id=session_id,
                answer=result["answer"],
                sources=result["sources"],
                steps=result["steps"],
            )
            _sessions[session_id] = list(result["message_history"])
            return response
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("RAG 问答执行失败")
        raise HTTPException(
            status_code=500, detail="问答服务执行失败，请稍后重试；详细原因请查看服务端日志。"
        ) from exc


# 显式清空指定会话；重新生成通过 POST /chat 的 regenerate 保留上下文。
@app.post("/chat/reset")
def reset_chat(session_id: Optional[str] = None):
    with _chat_lock:
        if session_id:
            _sessions.pop(session_id, None)
    return {"ok": True, "session_id": session_id}


def main():
    import uvicorn

    host = os.getenv("API_HOST", "0.0.0.0")
    port = int(os.getenv("API_PORT", "14052"))
    uvicorn.run("server:app", host=host, port=port, reload=False)


if __name__ == "__main__":
    main()
