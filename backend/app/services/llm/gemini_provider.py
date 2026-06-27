"""Gemini provider integration."""

import json
import urllib.error
import urllib.parse
import urllib.request

from app.core.config import settings
from app.services.llm.prompt_builder import (
    MAX_GEMINI_CONTEXT_CHARS,
    MIN_GEMINI_CONTEXT_CHARS,
    build_prompts,
    is_visual_request,
    multimodal_gemini_parts,
)
from app.services.llm.response_utils import llm_error, needs_korean_rewrite, parse_suggested_questions, postprocess_visual_answer


def extract_gemini_text(payload: dict) -> str:
    parts = (
        ((payload.get("candidates") or [{}])[0].get("content") or {}).get("parts")
        or []
    )
    return "\n".join(str(part.get("text", "")) for part in parts if part.get("text")).strip()


def call_gemini(
    api_key: str,
    model: str,
    system_prompt: str,
    user_prompt: str,
    image_parts: list[dict] | None = None,
    response_schema: dict | None = None,
) -> str:
    encoded_model = urllib.parse.quote(model, safe="")
    url = (
        "https://generativelanguage.googleapis.com/v1beta/models/"
        f"{encoded_model}:generateContent?key={urllib.parse.quote(api_key, safe='')}"
    )
    parts = [
        {
            "text": (
                "[System Instructions]\n"
                f"{system_prompt}\n\n"
                "[User Prompt]\n"
                f"{user_prompt}"
            )
        }
    ]
    parts.extend(image_parts or [])
    generation_config = {"temperature": 0.2}
    if response_schema:
        generation_config.update(
            {
                "responseMimeType": "application/json",
                "responseJsonSchema": response_schema,
            }
        )

    payload = {
        "contents": [
            {
                "role": "user",
                "parts": parts,
            }
        ],
        "generationConfig": generation_config,
    }
    request = urllib.request.Request(
        url,
        data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=300) as response:
        data = json.loads(response.read().decode("utf-8"))
    return extract_gemini_text(data)


def rewrite_answer_with_gemini(answer: str, api_key: str, model: str) -> str:
    prompt = (
        "아래 답변은 문서 분석 결과입니다. 사용자가 보는 최종 답변은 반드시 자연스러운 한국어여야 합니다.\n"
        "원문이 영어여도 분석 내용, 요약, 추천 질문, 표/차트 라벨 설명은 한국어로 번역하세요.\n"
        "고유명사, 논문 제목, 모델명, 기술 약어, 수치, 인용 표기, JSON 키, "
        "'===SUGGESTED_QUESTIONS===' 구분자는 보존하세요.\n"
        "의미를 추가하거나 삭제하지 말고 번역과 한국어 문장 다듬기만 수행하세요.\n\n"
        f"[답변]\n{answer}"
    )
    try:
        rewritten = call_gemini(
            api_key,
            model,
            "You are a Korean translation and editing assistant. Return only the rewritten Korean answer.",
            prompt,
        )
        return rewritten.strip() or answer
    except Exception as exc:
        print(f"Gemini Korean rewrite failed: {exc}")
        return answer


def http_error_detail(exc: urllib.error.HTTPError) -> str:
    try:
        raw = exc.read().decode("utf-8", errors="replace")
        parsed = json.loads(raw)
        message = (parsed.get("error") or {}).get("message")
        if message:
            return message
        return raw[:700]
    except Exception:
        return str(exc)


def analyze_with_gemini(
    question: str,
    extracted_docs: list[dict],
    api_key: str,
    analysis_text: str = "",
    relevant_chunks: list[dict] | None = None,
    web_docs: list[dict] | None = None,
) -> dict:
    model = settings.gemini_model
    visual_request = is_visual_request(question)

    attempts = [(model, MAX_GEMINI_CONTEXT_CHARS)]
    for fallback_model in ("gemini-2.5-flash-lite", "gemini-2.5-flash"):
        if fallback_model != model:
            attempts.append((fallback_model, MIN_GEMINI_CONTEXT_CHARS))

    last_error = ""
    used_model = model
    answer = ""
    for attempt_model, context_limit in attempts:
        used_model = attempt_model
        system_prompt, user_prompt = build_prompts(
            question,
            extracted_docs,
            analysis_text,
            relevant_chunks,
            context_limit=context_limit,
            web_docs=web_docs,
        )
        try:
            answer = call_gemini(
                api_key,
                attempt_model,
                system_prompt,
                user_prompt,
                multimodal_gemini_parts(extracted_docs),
            )
            break
        except urllib.error.HTTPError as exc:
            detail = http_error_detail(exc)
            last_error = f"HTTP {exc.code}: {detail}"
            if exc.code != 429:
                return llm_error(f"PaperMate 분석 호출 실패: {last_error}", "gemini", attempt_model)
        except Exception as exc:
            return llm_error(f"PaperMate 분석 호출 실패: {exc}", "gemini", attempt_model)
    else:
        return llm_error(f"PaperMate 분석 호출 실패: {last_error or '요청 한도에 걸렸습니다.'}", "gemini", used_model)

    if not answer:
        return llm_error("PaperMate 분석 엔진이 빈 답변을 반환했습니다.", "gemini", used_model)

    if visual_request:
        answer = postprocess_visual_answer(answer)
        return {
            "answer": answer,
            "suggested_questions": [],
            "llm_used": True,
            "model": used_model,
            "provider": "gemini",
        }

    if needs_korean_rewrite(answer):
        answer = rewrite_answer_with_gemini(answer, api_key, used_model)

    main_answer, questions = parse_suggested_questions(answer)
    return {
        "answer": main_answer,
        "suggested_questions": questions,
        "llm_used": True,
        "model": used_model,
        "provider": "gemini",
    }
