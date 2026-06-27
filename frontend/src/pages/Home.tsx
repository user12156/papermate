// TypeScript 변경 표시: JSX가 들어 있는 React 파일이라 .js에서 .tsx로 바꾼 파일입니다.
// TypeScript 변경 표시: 기존 JS 로직은 유지하면서 함수 인자와 화면 props에 실제 타입을 붙여 TypeScript 검사를 통과하게 했습니다.
// 초보자 안내: 사용자가 실제로 보게 되는 한 화면 단위의 React 페이지 컴포넌트입니다.

import React, { useCallback, useEffect, useRef, useState } from "react";
import Sidebar from "../components/Sidebar";
import {
  FiBarChart2,
  FiCopy,
  FiFileText,
  FiUsers,
} from "react-icons/fi";
import AuthModal from "../components/AuthModal";
import MypageC from "./Mypage";
import ShareC from "./Share";
import AnalysisC from "./Analysis";
import Project from "./Project";
import FAQC from "./FAQ";
import { useAuth } from "../context/AuthContext";
import {
  Container,
  SidebarSlot,
  SidebarHoverRail,
  MainContent,
  TopAuth,
  MainDashboard,
  DashboardBrand,
  GridContainer,
  HwpNotice,
  FeatureCard,
} from "./styles/Home.styles";
import {
  clearActiveAnalysisSessionIfMatched,
  getActiveAnalysisSessionKey,
  getProjectsKey,
  getRecentConversationsKey,
  readJson,
  recordMatchesAnyId,
  writeJson,
} from "../utils/storageKeys";
import papermateLogo from "../assets/papermate-logo.png";

const VIEW = {
  FAQ: "FAQ",
  MAIN: "main",
  SHARE: "공유작업공간",
  ANALYSIS: "분석 비교",
  PROJECTS: "내 프로젝트",
  MYPAGE: "마이페이지",
};

const VIEW_TO_ROUTE = {
  [VIEW.FAQ]: "faq",
  [VIEW.MAIN]: "home",
  [VIEW.SHARE]: "share",
  [VIEW.ANALYSIS]: "analysis",
  [VIEW.PROJECTS]: "projects",
  [VIEW.MYPAGE]: "mypage",
};

const ROUTE_TO_VIEW = Object.fromEntries(
  Object.entries(VIEW_TO_ROUTE).map(([view, route]) => [route, view]),
);

interface NavigateOptions {
  replace?: boolean;
  clearRestoredData?: boolean;
  clearShareOpenData?: boolean;
}

const getViewFromLocation = () => {
  const route = new URLSearchParams(window.location.search).get("view");
  return ROUTE_TO_VIEW[route] || VIEW.MAIN;
};

const syncBrowserHistory = (view: string, replace = false) => {
  const url = new URL(window.location.href);
  const route = VIEW_TO_ROUTE[view] || VIEW_TO_ROUTE[VIEW.MAIN];

  if (route === VIEW_TO_ROUTE[VIEW.MAIN]) url.searchParams.delete("view");
  else url.searchParams.set("view", route);

  const nextUrl = `${url.pathname}${url.search}${url.hash}`;
  const state = { ...(window.history.state || {}), papermateView: view };

  if (replace) window.history.replaceState(state, "", nextUrl);
  else window.history.pushState(state, "", nextUrl);
};

const getFriendlyAuthError = (error: any, fallback: string) => {
  if (!error?.response) {
    return error?.userMessage || "백엔드 서버와 연결할 수 없습니다. 서버가 켜져 있는지 확인한 뒤 다시 시도해주세요.";
  }
  return error.response?.data?.detail || error.message || fallback;
};

const pickFirstArray = (...values: any[]) =>
  values.find((value) => Array.isArray(value) && value.length > 0) || [];

const buildThreadFromSummary = (source: any = {}) =>
  [
    (source.q || source.question) && {
      id: `${source.id || source.projectId || "restored"}-q`,
      role: "user",
      text: source.q || source.question,
    },
    (source.a || source.answer || source.summary || source.analysis) && {
      id: `${source.id || source.projectId || "restored"}-a`,
      role: "ai",
      text: source.a || source.answer || source.summary || source.analysis,
    },
  ].filter(Boolean);

const getStoredThread = (project: any, conversation: any) => {
  const thread = pickFirstArray(
    project?.thread,
    project?.messages,
    project?.chat,
    project?.conversation,
    project?.conversationThread,
    project?.history,
    conversation?.thread,
    conversation?.messages,
    conversation?.chat,
    conversation?.conversation,
    conversation?.conversationThread,
    conversation?.history,
  );
  if (thread.length > 0) return thread;
  return buildThreadFromSummary(project).length > 0
    ? buildThreadFromSummary(project)
    : buildThreadFromSummary(conversation);
};

function Home() {
  const loadRecentConversations = () => {
    const parsed = readJson(getRecentConversationsKey(), []);
    return Array.isArray(parsed) ? parsed : [];
  };

  const { isLoggedIn, user, logout, login, signup, googleLogin, acceptOAuthRedirect, loading } = useAuth();
  const previousUserIdRef = useRef<string | null>(null);
  const [viewMode, setViewMode] = useState(getViewFromLocation);
  const [restoredData, setRestoredData] = useState<any>(null);
  const [shareOpenData, setShareOpenData] = useState<any>(null);
  const [recentConversations, setRecentConversations] = useState(
    loadRecentConversations,
  );
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(true);
  const [formData, setFormData] = useState({ id: "", pw: "", confirmPw: "" });
  const [authError, setAuthError] = useState("");
  const [authLoading, setAuthLoading] = useState(false);
  const [modalMode, setModalMode] = useState<'login' | 'signup' | 'recommend' | null>(null);
  const [pendingProtectedView, setPendingProtectedView] = useState<string | null>(null);
  const [analysisSessionKey, setAnalysisSessionKey] = useState(
    () => `analysis-${Date.now()}`,
  );
  const [newAnalysisSignal, setNewAnalysisSignal] = useState(0);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const authProvider = params.get("auth_provider");
    if (authProvider !== "kakao" && authProvider !== "naver") return;

    const authErrorMessage = params.get("auth_error");
    const nextUrl = new URL(window.location.href);
    ["auth_provider", "auth_token", "auth_user_id", "auth_username", "auth_error"].forEach((key) => {
      nextUrl.searchParams.delete(key);
    });
    window.history.replaceState(window.history.state || {}, "", `${nextUrl.pathname}${nextUrl.search}${nextUrl.hash}`);

    if (authErrorMessage) {
      setAuthError(authErrorMessage);
      setModalMode("login");
      return;
    }

    const accessToken = params.get("auth_token") || "";
    const userId = params.get("auth_user_id") || "";
    const username = params.get("auth_username") || "";
    if (!accessToken || !userId || !username) return;

    acceptOAuthRedirect({
      accessToken,
      user: { id: userId, username },
    });

    const storedProtectedView = sessionStorage.getItem("papermate.pendingProtectedView");
    sessionStorage.removeItem("papermate.pendingProtectedView");
    sessionStorage.removeItem("papermate.naverOAuthState");
    setModalMode(null);
    setFormData({ id: "", pw: "", confirmPw: "" });
    window.alert(authProvider === "naver" ? "네이버로 로그인되었습니다." : "카카오톡으로 로그인되었습니다.");

    if (storedProtectedView) {
      navigateToView(storedProtectedView, {
        replace: true,
        clearRestoredData: storedProtectedView !== VIEW.ANALYSIS,
        clearShareOpenData: storedProtectedView !== VIEW.SHARE,
      });
      setPendingProtectedView(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [acceptOAuthRedirect]);

  const navigateToView = (nextView: string, options: NavigateOptions = {}) => {
    const {
      replace = false,
      clearRestoredData = false,
      clearShareOpenData = false,
    } = options;

    if (clearRestoredData) setRestoredData(null);
    if (clearShareOpenData) setShareOpenData(null);
    setViewMode(nextView);
    syncBrowserHistory(nextView, replace);
  };

  const startFreshAnalysis = () => {
    sessionStorage.setItem("papermate.skipActiveAnalysisRestore", "1");
    const activeAnalysisKey = getActiveAnalysisSessionKey();
    localStorage.removeItem(activeAnalysisKey);
    window.dispatchEvent(new CustomEvent("papermate-storage-updated", {
      detail: { key: activeAnalysisKey },
    }));
    setRestoredData(null);
    setNewAnalysisSignal((prev) => prev + 1);
    setAnalysisSessionKey(`analysis-new-${Date.now()}-${Math.random()}`);
    navigateToView(VIEW.ANALYSIS, { clearRestoredData: true });
  };

  useEffect(() => {
    syncBrowserHistory(viewMode, true);

    const handlePopState = (event: PopStateEvent) => {
      const nextView = event.state?.papermateView || getViewFromLocation();
      setViewMode(nextView);
      if (nextView === VIEW.MAIN) {
        setRestoredData(null);
        setShareOpenData(null);
      }
    };

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const syncRecents = (event: any) => {
      if (event.detail?.key && event.detail.key !== getRecentConversationsKey())
        return;
      setRecentConversations(loadRecentConversations());
    };

    window.addEventListener("storage", syncRecents);
    window.addEventListener("papermate-storage-updated", syncRecents);
    return () => {
      window.removeEventListener("storage", syncRecents);
      window.removeEventListener("papermate-storage-updated", syncRecents);
    };
  }, []);

  useEffect(() => {
    const previousUserId = previousUserIdRef.current;
    const nextUserId = user?.id || null;
    previousUserIdRef.current = nextUserId;

    setRecentConversations(loadRecentConversations());

    if (!previousUserId) return;

    if (!nextUserId || previousUserId !== nextUserId) {
      setRestoredData(null);
      setShareOpenData(null);
      navigateToView(VIEW.MAIN, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  const handleInputChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = event.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
    setAuthError("");
  };

  const handleMenuRouting = (menuName: string) => {
    const protectedMenus = [
      VIEW.SHARE,
      VIEW.PROJECTS,
      VIEW.MYPAGE,
      "프로필",
    ];

    if (!isLoggedIn && protectedMenus.includes(menuName)) {
      const protectedTarget =
        menuName === VIEW.SHARE || menuName === VIEW.PROJECTS ? menuName : VIEW.MYPAGE;
      setPendingProtectedView(protectedTarget);
      setModalMode("recommend");
      return;
    }

    if (menuName === VIEW.SHARE)
      navigateToView(VIEW.SHARE, { clearShareOpenData: true });
    else if (menuName === VIEW.ANALYSIS) {
      startFreshAnalysis();
    } else if (menuName === VIEW.PROJECTS) navigateToView(VIEW.PROJECTS);
    else if (menuName === VIEW.MYPAGE || menuName === "프로필")
      navigateToView(VIEW.MYPAGE);
    else if (menuName === "새 채팅") startFreshAnalysis();
  };

  const openLoginPopup = () => {
    setAuthError("");
    setPendingProtectedView(null);
    setModalMode("login");
  };

  const openSignupPopup = () => {
    setAuthError("");
    setPendingProtectedView(null);
    setModalMode("signup");
  };

  const handleGoogleError = useCallback((message: string) => {
    setAuthError(message);
  }, []);

  const submitAuthRequest = async (mode: string) => {
    const usernameInput = formData.id.trim();
    const passwordInput = formData.pw;

    if (!usernameInput || !passwordInput) {
      setAuthError("아이디와 비밀번호를 입력해주세요.");
      return;
    }

    if (mode === "signup" && passwordInput !== formData.confirmPw) {
      setAuthError("비밀번호 확인이 일치하지 않습니다.");
      return;
    }

    setAuthLoading(true);
    setAuthError("");

    try {
      if (mode === "login") {
        await login(usernameInput, passwordInput);
        window.alert("로그인되었습니다.");
      } else {
        await signup(usernameInput, passwordInput);
        window.alert("회원가입이 완료되었습니다.");
      }
      setModalMode(null);
      setFormData({ id: "", pw: "", confirmPw: "" });

      if (pendingProtectedView) {
        navigateToView(pendingProtectedView, {
          clearRestoredData: pendingProtectedView !== VIEW.ANALYSIS,
          clearShareOpenData: pendingProtectedView !== VIEW.SHARE,
        });
        setPendingProtectedView(null);
      }
    } catch (error: any) {
      setAuthError(getFriendlyAuthError(error, "로그인 처리 중 오류가 발생했습니다."));
    } finally {
      setAuthLoading(false);
    }
  };

  const submitGoogleAuthRequest = async (idToken: string) => {
    setAuthLoading(true);
    setAuthError("");

    try {
      await googleLogin(idToken);
      window.alert("Google로 로그인되었습니다.");
      setModalMode(null);
      setFormData({ id: "", pw: "", confirmPw: "" });

      if (pendingProtectedView) {
        navigateToView(pendingProtectedView, {
          clearRestoredData: pendingProtectedView !== VIEW.ANALYSIS,
          clearShareOpenData: pendingProtectedView !== VIEW.SHARE,
        });
        setPendingProtectedView(null);
      }
    } catch (error: any) {
      setAuthError(getFriendlyAuthError(error, "Google 로그인에 실패했습니다."));
    } finally {
      setAuthLoading(false);
    }
  };

  const handleKakaoStart = () => {
    if (pendingProtectedView) {
      sessionStorage.setItem("papermate.pendingProtectedView", pendingProtectedView);
    } else {
      sessionStorage.removeItem("papermate.pendingProtectedView");
    }
    setAuthError("");
  };

  const handleNaverStart = () => {
    handleKakaoStart();
  };

  const handleAbsoluteLogout = () => {
    logout();
    navigateToView(VIEW.MAIN, {
      replace: true,
      clearRestoredData: true,
      clearShareOpenData: true,
    });
  };

  const handleTimelineRestoreJump = (historyData: any) => {
    if (!isLoggedIn) {
      setModalMode("recommend");
      return;
    }
    setRestoredData(historyData);
    navigateToView(VIEW.ANALYSIS);
  };

  const handleProjectRestoreJump = (projectData: any) => {
    if (!isLoggedIn) {
      setModalMode("recommend");
      return;
    }
    setRestoredData(projectData);
    setAnalysisSessionKey(
      `analysis-${projectData?.projectId || projectData?.id || projectData?.inviteCode || Date.now()}`,
    );
    navigateToView(VIEW.ANALYSIS);
  };

  const handleSharedProjectOpen = (projectData: any) => {
    if (!isLoggedIn) {
      setModalMode("recommend");
      return;
    }
    setShareOpenData(projectData);
    navigateToView(VIEW.SHARE);
  };

  const handleRecentConversationClick = (conversation: any) => {
    const projects = readJson(getProjectsKey(), []);
    const project = Array.isArray(projects)
      ? projects.find(
          (item) =>
            item.id === conversation.projectId ||
            item.id === conversation.id ||
            item.conversationId === conversation.conversationId ||
            item.inviteCode === conversation.inviteCode,
        )
      : null;
    const thread = getStoredThread(project, conversation);
    const lastUserMessage = [...thread]
      .reverse()
      .find((item) => item.role === "user");
    const lastAiMessage = [...thread]
      .reverse()
      .find((item) => item.role === "ai" || item.role === "asset");

    if (!conversation.question && !project && thread.length === 0) {
      navigateToView(VIEW.ANALYSIS);
      return;
    }

    setRestoredData({
      projectId: project?.id || conversation.projectId || conversation.id,
      conversationId: conversation.conversationId || conversation.id,
      q: lastUserMessage?.text || conversation.question || project?.title,
      a:
        lastAiMessage?.text ||
        `"${conversation.title}" 프로젝트로 저장된 최근 분석 대화입니다.`,
      projectTitle: project?.title || conversation.title,
      inviteCode: project?.inviteCode || conversation.inviteCode,
      files: pickFirstArray(
        project?.files,
        project?.sourceFiles,
        project?.uploadedFiles,
        conversation.files,
        conversation.sourceFiles,
        conversation.uploadedFiles,
      ),
      thread,
      visuals: pickFirstArray(project?.visuals, conversation.visuals),
    });
    setAnalysisSessionKey(
      `analysis-${conversation.conversationId || conversation.id || conversation.projectId || Date.now()}`,
    );
    navigateToView(VIEW.ANALYSIS);
  };

  const handleDeleteRecent = (id: string, event: React.MouseEvent) => {
    event?.stopPropagation();
    if (!window.confirm("이 최근 대화 기록을 삭제하시겠습니까?")) return;

    const deletedRecent = recentConversations.find(
      (item: any) => item.id === id || item.conversationId === id || item.projectId === id,
    );
    const deletedIds = [
      id,
      deletedRecent?.id,
      deletedRecent?.conversationId,
      deletedRecent?.projectId,
      deletedRecent?.inviteCode,
    ].filter(Boolean);
    const updatedRecents = recentConversations.filter((item: any) => !recordMatchesAnyId(item, deletedIds));
    setRecentConversations(updatedRecents);
    writeJson(getRecentConversationsKey(), updatedRecents);
    clearActiveAnalysisSessionIfMatched(deletedIds);

    const activeId =
      restoredData?.conversationId ||
      restoredData?.projectId ||
      restoredData?.id;
      
    // 💡 [오류 수정] 활성화된 채팅 삭제 시 VIEW.MAIN으로 정상 튕겨나가도록 수정
    if (recordMatchesAnyId(restoredData, deletedIds) || deletedIds.includes(activeId)) {
      setRestoredData(null);
      setAnalysisSessionKey(`analysis-${Date.now()}`);
      if (viewMode === VIEW.ANALYSIS) {
        navigateToView(VIEW.MAIN, { replace: true, clearRestoredData: true });
      }
    }
  };

  const handleConversationChange = (conversationId: string) => {
    const updatedRecents = loadRecentConversations();
    setRecentConversations(updatedRecents);
    const nextConversation = updatedRecents.find(
      (item: any) =>
        item.id === conversationId || item.conversationId === conversationId,
    );
    if (nextConversation) {
      setRestoredData((prev: any) => ({
        ...(prev || {}),
        id: conversationId,
        conversationId,
        projectId: nextConversation.projectId,
        projectTitle: nextConversation.title,
        inviteCode: nextConversation.inviteCode,
        files: nextConversation.files || [],
        thread: nextConversation.thread || [],
      }));
    }
  };

  const isFullView = [
  VIEW.SHARE,
  VIEW.ANALYSIS,
  VIEW.PROJECTS,
  VIEW.MYPAGE,
  VIEW.FAQ,
  ].includes(viewMode);
  const isProtectedFullView = [
    VIEW.SHARE,
    VIEW.PROJECTS,
    VIEW.MYPAGE,
  ].includes(viewMode);
  
  const activeConversationId =
    viewMode === VIEW.ANALYSIS
      ? restoredData?.conversationId ||
        restoredData?.projectId ||
        restoredData?.id ||
        null
      : null;

  useEffect(() => {
    if (loading || isLoggedIn || !isProtectedFullView) return;
    setPendingProtectedView(viewMode);
    setModalMode("recommend");
    navigateToView(VIEW.MAIN, {
      replace: true,
      clearRestoredData: true,
      clearShareOpenData: true,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, isLoggedIn, isProtectedFullView]);

  return (
    <Container>
      <SidebarHoverRail
        $visible={isSidebarCollapsed}
        onMouseEnter={() => setIsSidebarCollapsed(false)}
      />
      <SidebarSlot $collapsed={isSidebarCollapsed}>
        <Sidebar
          viewMode={viewMode}
          onMenuClick={handleMenuRouting}
          onLogoClick={() =>
            navigateToView(VIEW.MAIN, {
              clearRestoredData: true,
              clearShareOpenData: true,
            })
          }
          isLoggedIn={isLoggedIn}
          username={user?.username || "Guest"}
          userProfileImage={user?.profileImage || ""}
          onProfileClick={() => handleMenuRouting("프로필")}
          collapsed={isSidebarCollapsed}
          onCollapse={() => setIsSidebarCollapsed(true)}
          recentConversations={recentConversations}
          onRecentConversationClick={handleRecentConversationClick}
          onDeleteRecent={handleDeleteRecent}
          activeConversationId={activeConversationId}
        />
      </SidebarSlot>

      <MainContent
        $isFullView={isFullView}
        $sidebarCollapsed={isSidebarCollapsed}
        onClick={() => {
          if (!isSidebarCollapsed) setIsSidebarCollapsed(true);
        }}
      >
        {!isFullView && (
          <TopAuth>
            <span onClick={() => navigateToView(VIEW.FAQ)}>FAQ</span>
            {isLoggedIn ? (
              <span onClick={handleAbsoluteLogout}>Logout</span>
            ) : (
              <>
                <span onClick={openLoginPopup}>Login</span>
                <span onClick={openSignupPopup}>signup</span>
              </>
            )}
          </TopAuth>
        )}

        {viewMode === VIEW.MAIN && (
          <MainDashboard>
            {isSidebarCollapsed && (
              <DashboardBrand onClick={() => navigateToView(VIEW.MAIN)}>
                <img
                  className="logo-image"
                  src={papermateLogo}
                  alt="PaperMate"
                />
              </DashboardBrand>
            )}
            <h2>
              논문 읽는 시간을 1/10로,
              <br />
              작업의 깊이는 2배로
            </h2>
            <div className="sub">
              HWP, PDF 등 다양한 형식의 논문을 올리면 AI가 핵심을 분석하고
              <br />
              팀원과 실시간으로 공유할 수 있어요.
            </div>
          
            <GridContainer>
              {/* 첫 번째 카드: 문서 분석 (📑 이모지) */}
              <FeatureCard
                onClick={() => handleMenuRouting(VIEW.ANALYSIS)}
                $bgGradient="linear-gradient(135deg, #e0f2f1 0%, #b2dfdb 100%)"
              >
                <div className="floating-emoji">📑</div>

                <div className="content-wrapper">
                  <div className="icon-box">
                    <FiFileText />
                  </div>
                  <div className="text-box">
                    <h4>문서 분석 · 요약</h4>
                    <p>
                      HWP, HWPX, PDF 문서의 핵심 내용을 추출하고 요약합니다.
                    </p>
                  </div>
                </div>
              </FeatureCard>

              {/* 두 번째 카드: 데이터 시각화 (📊 이모지) */}
              <FeatureCard
                onClick={() => handleMenuRouting(VIEW.ANALYSIS)}
                $bgGradient="linear-gradient(135deg, #fff9c4 0%, #ffecb3 100%)"
              >
                <div className="floating-emoji">📊</div>

                <div className="content-wrapper">
                  <div className="icon-box">
                    <FiBarChart2 />
                  </div>
                  <div className="text-box">
                    <h4>데이터 시각화</h4>
                    <p>문서 속 데이터를 차트와 그래프로 변환합니다.</p>
                  </div>
                </div>
              </FeatureCard>

              {/* 세 번째 카드: 공유작업공간 (🚀 이모지) */}
              <FeatureCard
                onClick={() => handleMenuRouting(VIEW.SHARE)}
                $bgGradient="linear-gradient(135deg, #e3f2fd 0%, #bbdefb 100%)"
              >
                <div className="floating-emoji">🚀</div>

                <div className="content-wrapper">
                  <div className="icon-box">
                    <FiUsers />
                  </div>
                  <div className="text-box">
                    <h4>공유작업공간</h4>
                    <p>
                      초대 코드로 팀원을 초대하고 분석 결과를 함께 검토합니다.
                    </p>
                  </div>
                </div>
              </FeatureCard>
            </GridContainer>

            <HwpNotice>
              <span>HWP는 기본 분석만 지원합니다. 문서 미리보기, 이미지·차트 추출 등 전체 기능은 HWPX로 변환 후 이용해주세요.</span>
              <span>자세한 사항은 FAQ를 참고해 주셔요.</span>
            </HwpNotice>
          </MainDashboard>
        )}

        {viewMode === VIEW.PROJECTS && (
          <Project
            onProjectRestore={handleProjectRestoreJump}
            onShareProjectOpen={handleSharedProjectOpen}
          />
        )}
        {viewMode === VIEW.MYPAGE && (
          <MypageC onLogoutClick={handleAbsoluteLogout} />
        )}
        {viewMode === VIEW.FAQ && (
          <FAQC
            onBackHome={() => navigateToView(VIEW.MAIN, { replace: true })}
            showHomeLogo={isSidebarCollapsed}
          />
        )}
        {viewMode === VIEW.SHARE && (
          <ShareC
            key={
              shareOpenData?.projectId || shareOpenData?.inviteCode
                ? `share-${shareOpenData?.projectId || shareOpenData?.inviteCode}`
                : "share-new"
            }
            onRestoreTrigger={handleTimelineRestoreJump}
            username={user?.username}
            initialProject={shareOpenData}
          />
        )}
        {viewMode === VIEW.ANALYSIS && (
          <AnalysisC
            key={analysisSessionKey}
            restoredData={restoredData}
            newAnalysisSignal={newAnalysisSignal}
            clearRestore={() => setRestoredData(null)}
            onConversationChange={handleConversationChange}
            onLoginRequired={() => setModalMode("recommend")}
          />
        )}

        <AuthModal
          modalMode={modalMode}
          setModalMode={(mode) => {
            setModalMode(mode);
            if (!mode) setPendingProtectedView(null);
          }}
          formData={formData}
          onInputChange={handleInputChange}
          onLoginSubmit={() => submitAuthRequest("login")}
          onSignupSubmit={() => submitAuthRequest("signup")}
          onGoogleSubmit={submitGoogleAuthRequest}
          onGoogleError={handleGoogleError}
          onKakaoStart={handleKakaoStart}
          onNaverStart={handleNaverStart}
          authError={authError}
          authLoading={authLoading}
        />
      </MainContent>
    </Container>
  );
}

export default Home;
