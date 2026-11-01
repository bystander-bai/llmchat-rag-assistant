# ---------------------------------------------------------------------------
# RAG 应用入口：校验 Key、组装 retriever+各链、编译图、跑一轮问答
# get_graph / ask 已实现，供 server POST /chat 与 main.py 命令行使用
# ---------------------------------------------------------------------------
from modules.loader import Loader
from modules.models import (
    Router,
    DocGrader,
    Generator,
    HallucinationGrader,
    AnswerGrader,
    QuestionRewriter,
)
from modules.nodes import Nodes
from modules.graph import Graph
import sys

from modules.env_utils import load_project_env, read_env_value, validate_embedding_api_key, validate_llm_api_key

load_project_env()

_INITIAL_HISTORY = ["the messages till now are given below: \n\n"]

_graph = None
_nodes = None


# 启动前检查对话 Key 与 Embedding Key（占位/中文说明会直接退出）
def validate_env() -> None:
    llm_key = read_env_value(
        "HUNYUAN_API_KEY",
        "TOKENHUB_API_KEY",
        "OPENAI_API_KEY",
        "DEEPSEEK_API_KEY",
    )
    embed_key = read_env_value(
        "EMBEDDING_API_KEY",
        "HUNYUAN_API_KEY",
        "TOKENHUB_API_KEY",
        "OPENAI_API_KEY",
        "DASHSCOPE_API_KEY",
    )

    try:
        validate_llm_api_key(llm_key)
        validate_embedding_api_key(embed_key)
    except ValueError as exc:
        print(f"ERROR: {exc}\n")
        print(
            "请编辑实训四项目根目录 .env：\n"
            "  HUNYUAN_API_KEY=sk-问答用TokenHub密钥\n"
            "  OPENAI_API_BASE=https://tokenhub.tencentmaas.com/v1\n"
            "  LLM_MODEL=hy3\n"
            "  EMBEDDING_API_KEY=sk-向量化用TokenHub密钥\n"
            "  EMBEDDING_API_BASE=https://tokenhub.tencentmaas.com/v1\n"
            "  EMBEDDING_MODEL=kinfra-text-embedding-0.6b\n"
            "注意：等号后面只写密钥本身，不要写中文说明。"
        )
        sys.exit(1)


def get_graph():
    """Lazy-init LangGraph app once per process.（已实现，可直接使用）"""
    global _graph, _nodes
    if _graph is not None:
        return _graph, _nodes

    validate_env()
    print("Initializing retriever / vectorstore...")
    loader = Loader()

    class NodeHelpers:
        retriever = loader.get_retriever()
        question_router = Router.get_model()
        retrieval_grader = DocGrader.get_model()
        rag_chain = Generator.get_model()
        hallucination_grader = HallucinationGrader.get_model()
        answer_grader = AnswerGrader.get_model()
        question_rewriter = QuestionRewriter.get_model()

    _nodes = Nodes(NodeHelpers())
    _graph = Graph.create(_nodes)
    print("RAG graph ready.")
    return _graph, _nodes


def new_message_history():
    return list(_INITIAL_HISTORY)


# 执行一轮 graph.stream，组装 answer / sources / steps / 更新历史
def ask(question: str, message_history: list | None = None) -> dict:
    """执行一轮问答；返回最终状态摘要，调用方成功后再保存历史。"""
    if not isinstance(question, str) or not question.strip():
        raise ValueError("问题不能为空，请输入有效的问题。")
    question = question.strip()

    graph, nodes = get_graph()
    # route_question 会原地追加用户消息，复制历史以免失败时污染原会话。
    history = new_message_history() if message_history is None else list(message_history)
    inputs = {"question": question, "message_history": history, "documents": []}
    final_state = dict(inputs)
    steps = []
    for output in graph.stream(inputs):
        for node, update in output.items():
            final_state.update(update)
            steps.append({
                "node": node,
                "regeneration": nodes.REGENERATION_COUNT,
                "retrieval": nodes.RERETREVIAL_COUNT,
            })

    answer = final_state.get("generation")
    if not isinstance(answer, str) or not answer.strip():
        raise RuntimeError("问答流程未生成有效回答，请稍后重试。")
    answer = answer.strip()
    history = list(final_state["message_history"])
    history.append(f"msg number [{len(history)}] assistant : {answer}")

    sources = []
    for document in final_state.get("documents") or []:
        metadata = dict(document.metadata or {})
        sources.append({
            "source": metadata.get("source", ""),
            "metadata": metadata,
            "preview": document.page_content[:200],
        })

    return {
        "answer": answer,
        "message_history": history,
        "sources": sources,
        "steps": steps,
    }
