from langgraph.graph import END, StateGraph
from typing import List

from typing_extensions import TypedDict


# 图状态：问句、生成、检索文档、多轮历史
class GraphState(TypedDict):
    """
    Represents the state of our graph.
    """

    question: str
    generation: str
    documents: List[str]
    message_history: List[str]


class Graph:
    @staticmethod
    def create(nodes):
        """连接路由、检索、过滤、生成及重试分支，返回可执行的状态图。"""
        workflow = StateGraph(GraphState)

        workflow.add_node("retrieve", nodes.retrieve)
        workflow.add_node("grade_documents", nodes.grade_documents)
        workflow.add_node("generate", nodes.generate)
        workflow.add_node("generate_conv_reply", nodes.generate)
        workflow.add_node("transform_query", nodes.transform_query)

        workflow.set_conditional_entry_point(
            nodes.route_question,
            {
                "casual_convo": "generate_conv_reply",
                "vectorstore": "transform_query",
            },
        )
        workflow.add_edge("generate_conv_reply", END)
        workflow.add_edge("transform_query", "retrieve")
        workflow.add_edge("retrieve", "grade_documents")
        workflow.add_conditional_edges(
            "grade_documents",
            nodes.decide_to_generate,
            {
                "transform_query": "transform_query",
                "generate": "generate",
            },
        )
        workflow.add_conditional_edges(
            "generate",
            nodes.grade_generation_v_documents_and_question,
            {
                "not supported": "generate",
                "useful": END,
                "not useful": "transform_query",
            },
        )
        return workflow.compile()
