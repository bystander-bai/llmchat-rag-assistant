from typing import Literal

from langchain_core.prompts import ChatPromptTemplate
from langchain_core.output_parsers import StrOutputParser
from langchain_openai import ChatOpenAI
from pydantic import BaseModel, Field
import os

from modules.env_utils import load_project_env, read_env_value, validate_llm_api_key
from modules.structured_output import build_structured_output

load_project_env()

DEFAULT_LLM_MODEL = "hy3"
DEFAULT_LLM_API_BASE = "https://tokenhub.tencentmaas.com/v1"

LLM_MODEL = os.getenv("LLM_MODEL", DEFAULT_LLM_MODEL)
LLM_API_KEY = read_env_value(
    "HUNYUAN_API_KEY",
    "TOKENHUB_API_KEY",
    "OPENAI_API_KEY",
    "DEEPSEEK_API_KEY",
)
LLM_API_BASE = os.getenv(
    "OPENAI_API_BASE",
    os.getenv("HUNYUAN_API_URL", os.getenv("TOKENHUB_API_URL", DEFAULT_LLM_API_BASE)),
).rstrip("/")

validate_llm_api_key(LLM_API_KEY)


# 已实现：混元结构化输出默认 json_schema，避免 function_calling 502
def _structured_output_method() -> str:
    """TokenHub 混元对复杂 prompts 的 function_calling 易 502，默认改用 json_schema。"""
    explicit = os.getenv("LLM_STRUCTURED_METHOD", "").strip().lower()
    if explicit in {"function_calling", "json_schema", "json_mode"}:
        return explicit
    base = LLM_API_BASE.lower()
    model = LLM_MODEL.lower()
    if "tokenhub" in base or "hunyuan" in base or model.startswith("hy"):
        return "json_schema"
    return "function_calling"


def _structured(llm, schema):
    return build_structured_output(llm, schema, _structured_output_method())


def _chat_llm(temperature: float = 0):
    kwargs = {
        "model": LLM_MODEL,
        "temperature": temperature,
        "api_key": LLM_API_KEY,
        "base_url": LLM_API_BASE,
    }
    return ChatOpenAI(**kwargs)


# 客服路由 Prompt；输出 vectorstore | casual_convo，供 nodes.route_question
class Router:
    class RouteQuery(BaseModel):
        """Route a user query to the most relevant datasource."""

        datasource: Literal["vectorstore", "casual_convo"] = Field(
            ...,
            description="Given a user question choose to route it to casual_convo or a vectorstore.",
        )

    llm = _chat_llm()
    structured_llm_router = _structured(llm, RouteQuery)

    system = """你负责为企业客服问题选择数据源，不直接回答问题。
知识库覆盖企业微信、腾讯会议、腾讯云服务器、腾讯云对象存储、微信小程序和客服规则。
涉及这些产品的功能、配置、权限、接口、安全、操作、故障排查，以及服务范围、
服务时效、账号或订单问题、高风险操作和转人工等客服规则的问题，选择 vectorstore。
即使资料可能没有答案，也应先走检索路径，由回答环节说明资料边界。
包含寒暄但同时提出产品或客服问题时，仍选择 vectorstore。
“桌面端具体怎么操作？”等省略产品名的操作追问也选择 vectorstore，
交由后续问句改写环节结合会话历史补全。
纯寒暄和明显与知识库无关的闲聊选择 casual_convo。
例如：“企业微信如何获取 access_token？”、“腾讯会议如何加入会议？”、
“请帮我转人工”均选择 vectorstore；“你好”、“给我讲个笑话”选择 casual_convo。
只按给定结构返回 datasource，值只能为 vectorstore 或 casual_convo，不附加解释。"""
    route_prompt = ChatPromptTemplate.from_messages(
        [
            ("system", system),
            ("human", "{question}"),
        ]
    )

    question_router = route_prompt | structured_llm_router

    @staticmethod
    def get_model():
        return Router.question_router


# 已实现：检索文档是否相关（yes/no），供 nodes.grade_documents
class DocGrader:
    class GradeDocuments(BaseModel):
        """Binary score for relevance check on retrieved documents."""

        binary_score: Literal["yes", "no"] = Field(
            description="Documents are relevant to the question, 'yes' or 'no'"
        )

    llm = _chat_llm()
    structured_llm_grader = _structured(llm, GradeDocuments)

    system = """You are a grader assessing relevance of a retrieved document to a user question.
        If the document contains keyword(s) or semantic meaning related to the user question, grade it as relevant.
        It does not need to be a stringent test. The goal is to filter out erroneous retrievals.
        Give a binary score 'yes' or 'no' score to indicate whether the document is relevant to the question."""
    grade_prompt = ChatPromptTemplate.from_messages(
        [
            ("system", system),
            ("human", "Retrieved document: \n\n {document} \n\n User question: {question}"),
        ]
    )

    retrieval_grader = grade_prompt | structured_llm_grader

    @staticmethod
    def get_model():
        return DocGrader.retrieval_grader


# 客服生成 Prompt（只答库内、禁编资费、不确定转人工），供 nodes.generate
class Generator:
    system = """你是企业产品知识库客服，请遵守以下回答规则：
1. 产品事实只依据提供的检索资料。输入的 context 包含检索文档和聊天历史；
聊天历史仅用于理解追问与指代，不能把用户陈述或此前助手的回答当成已核实的产品事实。
2. 区分企业微信、腾讯会议、腾讯云服务器、腾讯云对象存储和微信小程序，
禁止混用不同产品的资料。无法确认产品、使用端、版本或具体场景时，先向用户澄清。
3. 不得编造资料未记载的价格、资费、功能、权限、版本、服务承诺、处理时效、
账号或订单状态、审批结果和操作执行成功的结论。不声称已查询用户的实时信息。
4. 资料足够时用简洁中文分步骤说明，仅引用资料中确实存在的来源、渠道及适用条件。
资料缺失、不足或相互冲突时，说明“根据现有资料无法确定”，
并建议通过对应产品的官方支持渠道咨询人工客服，不自行补充未经证实的结论。
5. 涉及敏感账户、退款争议、数据删除恢复、安全事件等高风险请求，遵守客服规则。
只能依据公开资料提供操作说明，不代用户执行操作；涉及删除、覆盖或权限变更时，
提醒用户确认对象和影响范围、必要时备份并遵循最小权限原则，无法判断风险时建议咨询人工。
不索取密码、完整密钥、访问令牌或验证码，不指导绕过身份验证或权限控制。
用户已发送敏感信息时，提醒停止发送并按官方流程处置，不复述敏感值。
6. 用户要求转人工或问题需人工核实时，给出咨询人工的建议；
不声称已接通人工坐席，不虚构客服电话、客服入口、工单编号或处理进度。
知识库中的课程客服规则仅用于教学演示，不将其表述为腾讯官方政策。
7. 纯寒暄可简短友好回应，不要求引用。明显超出服务范围的问题，简要说明服务范围，
建议咨询相应渠道，不以通用知识编造产品答案。"""

    prompt = ChatPromptTemplate.from_messages(
        [
            (
                "system",
                system,
            ),
            (
                "human",
                """请仅使用下列检索资料与对话历史回答问题；不要编造资料中没有的内容。
问题：{question}
检索资料与对话历史：{context}
回答：""",
            ),
        ]
    )

    llm = _chat_llm()
    rag_chain = prompt | llm | StrOutputParser()

    @staticmethod
    def get_model():
        return Generator.rag_chain


# 已实现：生成是否 grounded；供 nodes.grade_generation_v_documents_and_question
class HallucinationGrader:
    class GradeHallucinations(BaseModel):
        """Binary score for hallucination present in generation answer."""

        binary_score: Literal["yes", "no"] = Field(
            description="Answer is grounded in the facts, 'yes' or 'no'"
        )

    llm = _chat_llm()
    structured_llm_grader = _structured(llm, GradeHallucinations)

    system = """You are a grader assessing whether an LLM generation is grounded in / supported by a set of retrieved facts.
        Give a binary score 'yes' or 'no'. 'Yes' means that the answer is grounded in / supported by the set of facts.
        If the LLM Generation is saying that it doesnt know or not sure or stating to keep the questions relevant to topic , grade it as 'yes'."""
    hallucination_prompt = ChatPromptTemplate.from_messages(
        [
            ("system", system),
            (
                "human",
                "If the LLM Generation is saying that it doesnt know or not sure or stating to keep the questions relevant to topic , grade it as 'yes'. Set of facts: \n\n {documents} \n\n LLM generation: {generation}",
            ),
        ]
    )

    hallucination_grader = hallucination_prompt | structured_llm_grader

    @staticmethod
    def get_model():
        return HallucinationGrader.hallucination_grader


# 已实现：生成是否回答了问题；与幻觉打分一起决定 useful / not useful / not supported
class AnswerGrader:
    class GradeAnswer(BaseModel):
        """Binary score to assess answer addresses question."""

        binary_score: Literal["yes", "no"] = Field(
            description="Answer addresses the question, 'yes' or 'no'"
        )

    llm = _chat_llm()
    structured_llm_grader = _structured(llm, GradeAnswer)

    system = """You are a grader assessing whether an answer addresses / resolves a question
        Give a binary score 'yes' or 'no'. Yes' means that the answer resolves the question.
        If the LLM Generation is saying that it doesnt know or not sure or stating to keep the questions relevant to topic , grade it as 'yes'."""
    answer_prompt = ChatPromptTemplate.from_messages(
        [
            ("system", system),
            (
                "human",
                "If the LLM Generation is saying that it doesnt know or not sure or stating to keep the questions relevant to topic , grade it as 'yes'. User question: \n\n {question} \n\n LLM generation: {generation}",
            ),
        ]
    )

    answer_grader = answer_prompt | structured_llm_grader

    @staticmethod
    def get_model():
        return AnswerGrader.answer_grader


# 已实现：把用户问句改写成更适合检索的中文；供 nodes.transform_query
class QuestionRewriter:
    llm = _chat_llm()

    system = """你是检索问句改写器。将用户输入改写成更适合向量检索、简洁明确的中文问句。
可结合聊天历史补全指代与省略，并尽量保留或补全产品名称。知识库主题包括企业微信、
腾讯会议、腾讯云服务器、腾讯云对象存储和微信小程序的产品功能、配置方法、账号权限、
接口开发、安全设置、使用指南与故障排查。
只输出改写后的问句，不要解释。"""
    re_write_prompt = ChatPromptTemplate.from_messages(
        [
            ("system", system),
            (
                "human",
                "原始问题：\n\n {question} \n 请给出更优检索问句。\n\n 聊天历史：{chat_history}。",
            ),
        ]
    )

    question_rewriter = re_write_prompt | llm | StrOutputParser()

    @staticmethod
    def get_model():
        return QuestionRewriter.question_rewriter
