# 초보자 안내:
# 백엔드에서 쓰는 환경변수를 한곳에서 읽고 검증하는 설정 파일입니다.
# 다른 파일들이 os.getenv를 제각각 호출하면 배포 환경에서 값이 어긋나기 쉬워서,
# 여기의 settings 객체를 공통으로 사용합니다.

import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv


BACKEND_DIR = Path(__file__).resolve().parents[2]
PROJECT_ROOT = BACKEND_DIR.parent
ROOT_ENV_FILE = PROJECT_ROOT / ".env"
BACKEND_ENV_FILE = BACKEND_DIR / ".env"

# 실행 위치가 project_v1이든 backend이든 루트 공통 .env를 먼저 읽고,
# 백엔드 전용 값은 backend/.env가 덮어씁니다.
load_dotenv(ROOT_ENV_FILE)
load_dotenv(BACKEND_ENV_FILE, override=True)

DEFAULT_CORS_ORIGINS = [
    "http://localhost:3000",
    "http://localhost:3001",
    "http://127.0.0.1:3000",
    "http://127.0.0.1:3001",
    "http://localhost:8000",
    "http://127.0.0.1:8000",
    "http://localhost:5173",
    "http://127.0.0.1:5173",
]

DEFAULT_JWT_SECRET = "change-this-secret-in-production"


def _env_bool(name: str, default: bool = False) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "y", "on"}


def _env_int(name: str, default: int) -> int:
    value = os.getenv(name)
    if value is None or not value.strip():
        return default
    try:
        return int(value)
    except ValueError as exc:
        raise RuntimeError(f"{name} 환경변수는 숫자여야 합니다.") from exc


def _env_float(name: str, default: float) -> float:
    value = os.getenv(name)
    if value is None or not value.strip():
        return default
    try:
        return float(value)
    except ValueError as exc:
        raise RuntimeError(f"{name} 환경변수는 숫자여야 합니다.") from exc


def _env_list(name: str, default: list[str]) -> list[str]:
    configured = os.getenv(name, "")
    raw_values = configured.split(",") if configured else default

    values: list[str] = []
    for item in raw_values:
        normalized = item.strip().rstrip("/")
        if normalized and normalized not in values:
            values.append(normalized)
    return values


@dataclass(frozen=True)
class Settings:
    app_name: str
    app_env: str
    debug: bool
    enable_api_docs: bool
    log_level: str

    mongo_url: str
    mongo_db_name: str
    mongo_timeout_ms: int

    jwt_secret_key: str
    access_token_expire_minutes: int

    cors_origins: list[str]
    cors_origin_regex: str | None

    max_upload_mb: int
    max_upload_files: int

    hwpx_jar: str
    hwp_jar: str
    hwpx_loader: str
    hwp_loader: str
    java_bin: str
    hwp_parser_timeout_seconds: int
    openai_api_key: str
    openai_model: str
    gemini_api_key: str
    gemini_model: str
    anthropic_api_key: str
    anthropic_vision_model: str
    google_client_id: str
    kakao_rest_api_key: str
    kakao_client_secret: str
    kakao_redirect_uri: str
    kakao_frontend_redirect_uri: str
    naver_client_id: str
    naver_client_secret: str
    naver_redirect_uri: str
    naver_frontend_redirect_uri: str
    local_vlm_enabled: bool
    enable_bert_grounding: bool
    bert_grounding_model: str
    bert_grounding_threshold: float
    bert_grounding_instruction: str
    enable_topic_modeling: bool
    topic_model_backend: str
    topic_model_limit: int
    enable_local_translation: bool
    local_translation_auto_install: bool

    @property
    def is_production(self) -> bool:
        return self.app_env in {"prod", "production"}

    @property
    def max_upload_bytes(self) -> int:
        return self.max_upload_mb * 1024 * 1024

    def validate(self) -> None:
        if self.is_production and self.jwt_secret_key == DEFAULT_JWT_SECRET:
            raise RuntimeError("배포 환경에서는 JWT_SECRET_KEY를 반드시 안전한 값으로 변경해야 합니다.")
        if self.access_token_expire_minutes <= 0:
            raise RuntimeError("ACCESS_TOKEN_EXPIRE_MINUTES는 1 이상이어야 합니다.")
        if self.max_upload_mb <= 0:
            raise RuntimeError("MAX_UPLOAD_MB는 1 이상이어야 합니다.")
        if self.max_upload_files <= 0:
            raise RuntimeError("MAX_UPLOAD_FILES는 1 이상이어야 합니다.")
        if self.hwp_parser_timeout_seconds <= 0:
            raise RuntimeError("HWP_PARSER_TIMEOUT_SECONDS는 1 이상이어야 합니다.")
        if not 0 < self.bert_grounding_threshold <= 1:
            raise RuntimeError("BERT_GROUNDING_THRESHOLD는 0보다 크고 1 이하여야 합니다.")
        if self.topic_model_limit <= 0:
            raise RuntimeError("TOPIC_MODEL_LIMIT는 1 이상이어야 합니다.")


def create_settings() -> Settings:
    settings = Settings(
        app_name=os.getenv("APP_NAME", "PaperMate API"),
        app_env=os.getenv("APP_ENV", "development").strip().lower(),
        debug=_env_bool("DEBUG", False),
        enable_api_docs=_env_bool("ENABLE_API_DOCS", False),
        log_level=os.getenv("LOG_LEVEL", "INFO").strip().upper(),
        mongo_url=os.getenv("MONGO_URL", "mongodb://localhost:27017"),
        mongo_db_name=os.getenv("MONGO_DB_NAME", "papermate"),
        mongo_timeout_ms=_env_int("MONGO_TIMEOUT_MS", 2000),
        jwt_secret_key=os.getenv("JWT_SECRET_KEY", DEFAULT_JWT_SECRET),
        access_token_expire_minutes=_env_int("ACCESS_TOKEN_EXPIRE_MINUTES", 1440),
        cors_origins=_env_list("CORS_ORIGINS", DEFAULT_CORS_ORIGINS),
        cors_origin_regex=os.getenv("CORS_ORIGIN_REGEX", "").strip() or None,
        max_upload_mb=_env_int("MAX_UPLOAD_MB", 25),
        max_upload_files=_env_int("MAX_UPLOAD_FILES", 10),
        hwpx_jar=os.getenv("HWPX_JAR", "").strip(),
        hwp_jar=os.getenv("HWP_JAR", "").strip(),
        hwpx_loader=os.getenv("HWPX_LOADER", "").strip(),
        hwp_loader=os.getenv("HWP_LOADER", "").strip(),
        java_bin=os.getenv("JAVA_BIN", "java").strip() or "java",
        hwp_parser_timeout_seconds=_env_int("HWP_PARSER_TIMEOUT_SECONDS", 30),
        openai_api_key=os.getenv("OPENAI_API_KEY", "").strip(),
        openai_model=os.getenv("OPENAI_MODEL", "gpt-4o-mini").strip(),
        gemini_api_key=os.getenv("GEMINI_API_KEY", "").strip(),
        gemini_model=os.getenv("GEMINI_MODEL", "gemini-1.5-flash").strip(),
        anthropic_api_key=os.getenv("ANTHROPIC_API_KEY", "").strip(),
        anthropic_vision_model=os.getenv("ANTHROPIC_VISION_MODEL", "claude-3-5-sonnet-20241022").strip(),
        google_client_id=(os.getenv("GOOGLE_CLIENT_ID") or os.getenv("VITE_GOOGLE_CLIENT_ID", "")).strip(),
        kakao_rest_api_key=(
            os.getenv("KAKAO_REST_API_KEY")
            or os.getenv("KAKAO_CLIENT_ID")
            or os.getenv("VITE_KAKAO_REST_API_KEY")
            or os.getenv("VITE_KAKAO_CLIENT_ID", "")
        ).strip(),
        kakao_client_secret=os.getenv("KAKAO_CLIENT_SECRET", "").strip(),
        kakao_redirect_uri=os.getenv("KAKAO_REDIRECT_URI", "http://localhost:8000/auth/kakao/callback").strip(),
        kakao_frontend_redirect_uri=(
            os.getenv("KAKAO_FRONTEND_REDIRECT_URI")
            or os.getenv("FRONTEND_URL")
            or "http://localhost:3000"
        ).strip().rstrip("/"),
        naver_client_id=(os.getenv("NAVER_CLIENT_ID") or os.getenv("VITE_NAVER_CLIENT_ID", "")).strip(),
        naver_client_secret=os.getenv("NAVER_CLIENT_SECRET", "").strip(),
        naver_redirect_uri=os.getenv("NAVER_REDIRECT_URI", "http://localhost:8000/auth/naver/callback").strip(),
        naver_frontend_redirect_uri=(
            os.getenv("NAVER_FRONTEND_REDIRECT_URI")
            or os.getenv("FRONTEND_URL")
            or "http://localhost:3000"
        ).strip().rstrip("/"),
        local_vlm_enabled=_env_bool("LOCAL_VLM_ENABLED", False),
        enable_bert_grounding=_env_bool("ENABLE_BERT_GROUNDING", False),
        bert_grounding_model=os.getenv(
            "BERT_GROUNDING_MODEL",
            "paraphrase-multilingual-MiniLM-L12-v2",
        ).strip(),
        bert_grounding_threshold=_env_float("BERT_GROUNDING_THRESHOLD", 0.62),
        bert_grounding_instruction=os.getenv(
            "BERT_GROUNDING_INSTRUCTION",
            "Given an answer sentence, retrieve the most relevant source passage from the uploaded document.",
        ).strip(),
        enable_topic_modeling=_env_bool("ENABLE_TOPIC_MODELING", True),
        topic_model_backend=os.getenv("TOPIC_MODEL_BACKEND", "local").strip().lower(),
        topic_model_limit=_env_int("TOPIC_MODEL_LIMIT", 5),
        enable_local_translation=_env_bool("ENABLE_LOCAL_TRANSLATION", True),
        local_translation_auto_install=_env_bool("LOCAL_TRANSLATION_AUTO_INSTALL", True),
    )
    settings.validate()
    return settings


settings = create_settings()
