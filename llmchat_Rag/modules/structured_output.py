"""Validate structured model replies and retry invalid output once."""
import json

from langchain_core.exceptions import OutputParserException
from langchain_core.messages import HumanMessage, convert_to_messages
from langchain_core.runnables import RunnableLambda


class ModelResponseError(RuntimeError):
    """The upstream model returned no usable structured result."""


def build_structured_output(llm, schema, method):
    structured = llm.with_structured_output(schema, method=method, include_raw=True)

    def invoke(value, config):
        request = value
        last_error = None
        for attempt in range(2):
            try:
                result = structured.invoke(request, config=config)
                raw = result["raw"]
                if raw.additional_kwargs.get("refusal"):
                    raise ModelResponseError("模型未能完成结构化判断，请稍后重试。")
                if result["parsed"] is not None:
                    return schema.model_validate(result["parsed"])
                last_error = result["parsing_error"]
            except UnicodeEncodeError:
                raise
            except (ValueError, OutputParserException) as exc:
                last_error = exc

            if attempt == 0:
                messages = (
                    [HumanMessage(content=value)]
                    if isinstance(value, str) else convert_to_messages(value)
                )
                request = [*messages, HumanMessage(content=(
                    "上一次响应未包含有效的结构化结果。请重新完成上述判断，"
                    "只输出符合以下 JSON Schema 的 JSON 对象，包含所有必填字段：\n"
                    + json.dumps(schema.model_json_schema(), ensure_ascii=False)
                ))]

        raise ModelResponseError(
            "模型连续返回空内容或无效的结构化结果，请稍后重试。"
        ) from last_error

    return RunnableLambda(invoke)
