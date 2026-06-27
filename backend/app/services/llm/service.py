"""Public LLM analysis entrypoint."""

import json

from app.core.config import settings
from app.services.analysis.compare_builder import build_document_compare_answer
from app.services.analysis.query_analyzer import is_compare_request
from app.services.llm.openai_provider import analyze_with_openai
from app.services.llm.response_utils import llm_error
from app.services.table.chart_request_parser import parse_chart_request
from app.services.table.table_chart_builder import try_build_chart_from_tables

try:
    from app.services.llm.gemini_provider import analyze_with_gemini
except Exception:
    analyze_with_gemini = None


MISSING_API_KEY_MESSAGE = "PaperMate 분석 키가 없어 기본 문서 추출로 응답했습니다."


def _is_chart_request(question: str) -> bool:
    lowered = (question or "").lower()
    chart_keywords = ("그래프", "차트", "막대", "선 그래프", "꺾은선", "chart", "graph", "bar", "line")
    return any(keyword in lowered or keyword in (question or "") for keyword in chart_keywords)


def _chart_response(chart_json: dict, provider: str, model: str | None = None) -> dict:
    return {
        "answer": json.dumps(chart_json, ensure_ascii=False),
        "suggested_questions": [],
        "llm_used": True,
        "provider": provider,
        "model": model,
    }


def _compare_response(compare_payload: dict, provider: str, model: str | None = None) -> dict:
    return {
        "answer": compare_payload["answer"],
        "comparison_table": compare_payload.get("comparison_table", []),
        "time_series_comparison_table": compare_payload.get("time_series_comparison_table", []),
        "experiment_comparison_table": compare_payload.get("experiment_comparison_table", []),
        "experiment_chart": compare_payload.get("experiment_chart"),
        "compare": compare_payload.get("compare", {}),
        "suggested_questions": compare_payload.get("suggested_questions", []),
        "llm_used": True,
        "provider": provider,
        "model": model,
    }


def analyze_with_llm(
    question: str,
    extracted_docs: list[dict],
    provider: str = "gemini",
    openai_api_key: str | None = None,
    analysis_text: str = "",
    relevant_chunks: list[dict] | None = None,
    web_docs: list[dict] | None = None,
) -> dict:
    gemini_api_key = getattr(settings, "gemini_api_key", None)
    gemini_model = getattr(settings, "gemini_model", "gemini-1.5-flash")

    if gemini_api_key and analyze_with_gemini:
        provider_name = "gemini"
        model_name = gemini_model
    else:
        provider_name = "openai"
        model_name = settings.openai_model

    if is_compare_request(question) or len([doc for doc in extracted_docs if str(doc.get("text", "")).strip()]) >= 2:
        compare_payload = build_document_compare_answer(question, extracted_docs)
        if compare_payload:
            return _compare_response(compare_payload, provider_name, model_name)

    if _is_chart_request(question):
        table_chart = try_build_chart_from_tables(question, extracted_docs)
        if table_chart:
            return _chart_response(table_chart, provider_name, model_name)
        parsed_request = parse_chart_request(question)
        if parsed_request.get("metric") and parsed_request.get("dimension"):
            return _chart_response(
                {
                    "type": "chart_error",
                    "message": "문서 표에서 요청한 그래프의 기준 컬럼과 값 컬럼을 안정적으로 찾지 못했습니다.",
                },
                provider_name,
                model_name,
            )

    if gemini_api_key and analyze_with_gemini:
        return analyze_with_gemini(
            question,
            extracted_docs,
            gemini_api_key,
            analysis_text,
            relevant_chunks,
            web_docs,
        )

    api_key = openai_api_key or settings.openai_api_key
    if not api_key:
        return llm_error(MISSING_API_KEY_MESSAGE, "openai", settings.openai_model)

    return analyze_with_openai(question, extracted_docs, api_key, analysis_text, relevant_chunks, web_docs)