// TypeScript 변경 표시: JSX가 없는 유틸/API 파일이라 .js에서 .ts로 바꾼 파일입니다.
// TypeScript 변경 표시: 기존 동작은 유지하고, 이후 함수 인자/반환 타입을 점진적으로 붙일 수 있습니다.
// 초보자 안내: 프론트엔드에서 백엔드 API를 호출할 때 공통으로 사용하는 axios 설정 파일입니다.

import axios from 'axios';

interface AnalysisChatOptions {
  conversationId?: string;
  documentIds?: string[];
  useCurrentFilesOnly?: boolean;
  selectedSourceName?: string;
  compareMode?: boolean;
}

const isBrowserFile = (file: unknown): file is File | Blob =>
  (typeof File !== 'undefined' && file instanceof File) ||
  (typeof Blob !== 'undefined' && file instanceof Blob);

const getApiBaseUrl = () => {
  // TypeScript 변경 표시: Vite에서는 CRA의 process.env 대신 import.meta.env로 환경변수를 읽습니다.
  const configuredUrl = import.meta.env.VITE_API_BASE_URL || import.meta.env.REACT_APP_API_BASE_URL;

  if (configuredUrl) {
    return configuredUrl.replace(/\/$/, '');
  }

  if (!import.meta.env.DEV) {
    // eslint-disable-next-line no-console
    console.warn('VITE_API_BASE_URL is not set. Vercel production builds should point this to the EC2 backend URL.');
  }

  return import.meta.env.DEV ? 'http://localhost:8000' : '';
};

const API_BASE_URL = getApiBaseUrl();
const LOCAL_DEV_TOKEN_PREFIX = 'local-dev-token:';

const isLocalDevToken = (token: string | null) =>
  Boolean(token?.startsWith(LOCAL_DEV_TOKEN_PREFIX));

const CONNECTION_ERROR_MESSAGE =
  '백엔드 서버와 연결할 수 없습니다. 서버가 켜져 있는지 확인한 뒤 다시 시도해주세요.';

const apiClient = axios.create({
  baseURL: API_BASE_URL,
});

// 모든 API 요청을 보내기 직전에 실행됩니다.
// 로그인 토큰이 있으면 Authorization 헤더에 자동으로 붙여서 백엔드가 사용자를 알아볼 수 있게 합니다.
apiClient.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('accessToken');
    if (token && !isLocalDevToken(token)) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error)
);

// 백엔드가 401을 보내도 전역에서 즉시 로그아웃시키지 않습니다.
// 저장/미리보기/프로필 같은 개별 행동 중 일시적인 401이 나와도 화면 상태를 보존합니다.
apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    const requestUrl = error.config?.url || '';
    const isAuthSubmitRequest =
      requestUrl.includes('/api/auth/login') ||
      requestUrl.includes('/api/auth/signup') ||
      requestUrl.includes('/api/auth/google') ||
      requestUrl.includes('/api/auth/kakao') ||
      requestUrl.includes('/api/auth/naver');

    if (!error.response) {
      error.userMessage = CONNECTION_ERROR_MESSAGE;
      return Promise.reject(error);
    }

    const skipGlobalAuthRedirect = Boolean((error.config as any)?._skipGlobalAuthRedirect);

    if (error.response?.status === 401 && !isAuthSubmitRequest && !skipGlobalAuthRedirect) {
      const currentToken = localStorage.getItem('accessToken');
      const hadAuthHeader = Boolean(error.config?.headers && (error.config.headers.Authorization || error.config.headers.authorization));
      error.userMessage = error.response?.data?.detail || '로그인이 필요하거나 세션이 만료되었습니다. 다시 로그인 후 시도해주세요.';

      // eslint-disable-next-line no-console
      console.warn('Received 401 without automatic logout:', {
        requestUrl,
        hadAuthHeader,
        localDevToken: isLocalDevToken(currentToken),
      });
    }
    return Promise.reject(error);
  }
);

export const authAPI = {
  signup: (username: string, password: string) =>
    apiClient.post('/api/auth/signup', { username, password }),

  login: (username: string, password: string) =>
    apiClient.post('/api/auth/login', { username, password }),

  googleLogin: (idToken: string) =>
    apiClient.post('/api/auth/google', { id_token: idToken }),

  googleConfig: () =>
    apiClient.get('/api/auth/google/config'),

  kakaoConfig: () =>
    apiClient.get('/api/auth/kakao/config'),

  naverConfig: () =>
    apiClient.get('/api/auth/naver/config'),

  healthCheck: () => apiClient.get('/api/health'),

  updateProfile: (username: string) =>
    apiClient.patch('/api/auth/profile', { username }),

  changePassword: (currentPassword: string, newPassword: string) =>
    apiClient.patch('/api/auth/password', {
      current_password: currentPassword,
      new_password: newPassword,
    }),

  deleteAccount: () => apiClient.delete('/api/auth/account'),
};

export const analysisAPI = {
  previewDocument: (file: File) => {
    const formData = new FormData();
    formData.append('file', file, file.name || 'document');

    return apiClient.post('/api/document-previews/pdf', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
      responseType: 'blob',
    });
  },
  chat: (question: string, files: File[], options: AnalysisChatOptions = {}, analysisText = '') => {
    const formData = new FormData();
    formData.append('question', question);
    formData.append('llm_provider', 'gemini');
    if (options.conversationId) formData.append('conversation_id', options.conversationId);
    (options.documentIds || []).forEach((documentId) => {
      formData.append('document_ids', documentId);
    });
    formData.append('use_current_files_only', options.useCurrentFilesOnly ? 'true' : 'false');
    if (options.selectedSourceName) formData.append('selected_source_name', options.selectedSourceName);
    formData.append('compare_mode', options.compareMode ? 'true' : 'false');
    if (analysisText) formData.append('analysis_text', analysisText);
    files.filter(isBrowserFile).forEach((file) => {
      const filename = file instanceof File ? file.name : 'upload-file';
      formData.append('files', file, filename);
    });

    return apiClient.post('/api/analysis/chat', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },
  generateChatTitle: (question: string, analysisText = '') => {
    const formData = new FormData();
    formData.append('question', question);
    if (analysisText) formData.append('analysis_text', analysisText);

    return apiClient.post('/api/analysis/title', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },
  createVisual: (type: string, files: File[], analysisText = '') => {
    const formData = new FormData();
    formData.append('analysis_text', analysisText);
    files.filter(isBrowserFile).forEach((file) => {
      const filename = file instanceof File ? file.name : 'upload-file';
      formData.append('files', file, filename);
    });

    return apiClient.post(`/api/visuals/${encodeURIComponent(type)}`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },
};

export const projectAPI = {
  list: () => apiClient.get('/api/projects'),
  sync: (projects: unknown[]) => apiClient.put('/api/projects/sync', { projects }),
  save: (project: unknown) =>
    apiClient.post('/api/projects', { project }, { _skipGlobalAuthRedirect: true } as any),
  delete: (projectId: string) => apiClient.delete(`/api/projects/${encodeURIComponent(projectId)}`),
  findByInviteCode: (inviteCode: string) => apiClient.get(`/api/projects/invite/${encodeURIComponent(inviteCode)}`),
};

export default apiClient;
