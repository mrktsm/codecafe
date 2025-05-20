import React from "react";
import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import axios from "axios";
import { LANGUAGE_VERSIONS } from "./constants/languageVersions";
import { v4 as uuidv4 } from "uuid";
import { editor } from "monaco-editor";
import { RemoteUser, ChatMessageType } from "./types/props";
import StatusBar from "./components/StatusBar";
import {
  CodeExecutionRequest,
  CodeExecutionResponse,
  TerminalHandle,
  SearchOptions,
  MatchInfo,
} from "./types/editor";

import {
  ICON_BAR_WIDTH,
  DEFAULT_EXPLORER_WIDTH,
  MIN_EXPLORER_WIDTH,
  MAX_EXPLORER_WIDTH,
  DEFAULT_TERMINAL_HEIGHT_FRACTION,
  MIN_TERMINAL_HEIGHT_PX,
  TERMINAL_COLLAPSE_THRESHOLD_PX,
  DEFAULT_WEBVIEW_WIDTH_FRACTION,
  MIN_WEBVIEW_WIDTH,
} from "./constants/layout";
import { MOCK_FILES } from "./constants/mockFiles";
import { isExecutableLanguage } from "./utils/languageUtils";
import { useResizablePanel } from "./hooks/useResizablePanel";
import { useCollaborationSession } from "./hooks/useCollaborationSession";
import { useSessionManager } from "./hooks/useSessionManager";
import Header from "./components/Header";
import Sidebar from "./components/Sidebar";
import MainEditorArea from "./components/MainEditorArea";
import { useFileStore } from "./store/useFileStore";
import { Analytics } from "@vercel/analytics/react";

const App = () => {
  // REFS
  const terminalRef = useRef<TerminalHandle>();
  const sidebarContainerRef = useRef<HTMLDivElement>(null);
  const editorTerminalAreaRef = useRef<HTMLDivElement>(null);
  const mainContentRef = useRef<HTMLDivElement>(null);
  const tabContainerRef = useRef<HTMLDivElement>(null);
  const editorInstanceRef = useRef<editor.IStandaloneCodeEditor | null>(null);

  // STATE
  const [activeIcon, setActiveIcon] = useState<string | null>(null);

  const { openFiles, activeFileId } = useFileStore();

  const fileContents = useFileStore((state) => state.fileContents);

  const openFile = useFileStore((state) => state.openFile);
  const closeFile = useFileStore((state) => state.closeFile);
  const switchTab = useFileStore((state) => state.switchTab);
  const setFileContent = useFileStore((state) => state.setFileContent);

  const [isViewMenuOpen, setIsViewMenuOpen] = useState(false);

  const [isShareMenuOpen, setIsShareMenuOpen] = useState(false);

  const [cursorLine] = useState(1);
  const [cursorColumn] = useState(1);

  const [remoteUsers, setRemoteUsers] = useState<{
    [docId: string]: RemoteUser[];
  }>({});

  const [tabsHaveOverflow, setTabsHaveOverflow] = useState(false);

  const [searchTerm, setSearchTerm] = useState("");
  const [replaceValue, setReplaceValue] = useState("");
  const [searchOptions, setSearchOptions] = useState<SearchOptions>({
    matchCase: false,
    wholeWord: false,
    isRegex: false,
    preserveCase: false,
  });
  const [matchInfo, setMatchInfo] = useState<MatchInfo | null>(null);
  const findResultsDecorationIds = useRef<string[]>([]);
  const [isWidgetForcedHidden, setIsWidgetForcedHidden] = useState(false);

  const [chatMessages, setChatMessages] = useState<ChatMessageType[]>([]);

  // User Identity
  const [userId] = useState<string>(() => "user-" + uuidv4());

  // Instantiate Resizable Panels
  const explorerPanelRef = useRef<HTMLDivElement>(null);
  const {
    size: rawExplorerPanelSize,
    isResizing: isExplorerPanelResizing,
    handleMouseDown: handleExplorerPanelMouseDown,
    togglePanel: toggleExplorerPanel,
    isCollapsed: isExplorerCollapsed,
    setSize: setRawExplorerPanelSize,
  } = useResizablePanel({
    initialSize: DEFAULT_EXPLORER_WIDTH,
    minSize: MIN_EXPLORER_WIDTH,
    maxSize: MAX_EXPLORER_WIDTH,
    direction: "horizontal-left",
    containerRef: sidebarContainerRef,
    panelRef: explorerPanelRef,
    storageKey: "explorerWidth",
    defaultOpenSize: DEFAULT_EXPLORER_WIDTH,
  });
  const explorerPanelSize = Math.max(0, rawExplorerPanelSize - ICON_BAR_WIDTH);
  const setExplorerPanelSize = useCallback(
    (newSize: number) => {
      setRawExplorerPanelSize(newSize + ICON_BAR_WIDTH);
    },
    [setRawExplorerPanelSize]
  );

  // Use Session Manager Hook
  const {
    sessionId,
    isSessionActive,
    setIsSessionActive,
    joinState,
    setJoinState,
    userName,
    setUserName,
    userColor,
    setUserColor,
    isColorPickerOpen,
    setIsColorPickerOpen,
    shareMenuView,
    setShareMenuView,
    generatedShareLink,
    handleStartSession,
    handleCopyShareLink,
    handleConfirmJoin,
  } = useSessionManager({
    activeIcon,
    setActiveIcon,
    explorerPanelSize,
    setExplorerPanelSize,
    isExplorerCollapsed,
    toggleExplorerPanel,
  });

  // Generic function to set active icon for simple panels (files, search, chat etc.)
  const openPanelWithIcon = (iconName: string) => {
    if (
      activeIcon === "share" &&
      joinState === "prompting" &&
      iconName !== "share"
    ) {
      return; // Do nothing, keep the join panel open
    }

    if (iconName === "share") {
      handleShareIconClick();
    } else {
      if (joinState === "prompting" && activeIcon === "share") {
        setJoinState("idle");
      }
      setActiveIcon(iconName);
    }
  };

  const handleShareIconClick = () => {
    if (activeIcon === "share") {
      // If the share panel is already open
      setActiveIcon(null); // Close panel
      if (joinState === "prompting") {
        setJoinState("idle");
      }
    } else {
      // Opening share panel (or switching to it from another panel)
      setActiveIcon("share");
    }
  };

  const initialMaxTerminalHeight = window.innerHeight * 0.8;
  const {
    size: terminalPanelHeight,
    isResizing: isTerminalPanelResizing,
    handleMouseDown: handleTerminalPanelMouseDown,
    togglePanel: toggleTerminalPanel,
    isCollapsed: isTerminalCollapsed,
  } = useResizablePanel({
    initialSize: () => window.innerHeight * DEFAULT_TERMINAL_HEIGHT_FRACTION,
    minSize: MIN_TERMINAL_HEIGHT_PX,
    maxSize: initialMaxTerminalHeight,
    direction: "vertical",
    containerRef: editorTerminalAreaRef,
    storageKey: "terminalHeight",
    collapseThreshold: TERMINAL_COLLAPSE_THRESHOLD_PX,
    defaultOpenSize: () =>
      window.innerHeight * DEFAULT_TERMINAL_HEIGHT_FRACTION,
    onResizeEnd: () => {
      terminalRef.current?.fit();
    },
    onToggle: () => {
      requestAnimationFrame(() => terminalRef.current?.fit());
    },
  });

  const initialMaxWebViewWidth = window.innerWidth * 0.8;
  const webViewPanelRef = useRef<HTMLDivElement>(null);
  const {
    size: webViewPanelWidth,
    isResizing: isWebViewPanelResizing,
    handleMouseDown: handleWebViewPanelMouseDown,
    togglePanel: toggleWebViewPanel,
    isCollapsed: isWebViewCollapsed,
  } = useResizablePanel({
    initialSize: 0,
    minSize: MIN_WEBVIEW_WIDTH,
    maxSize: initialMaxWebViewWidth,
    direction: "horizontal-right",
    containerRef: mainContentRef,
    panelRef: webViewPanelRef,
    storageKey: "webViewWidth",
    defaultOpenSize: () =>
      (mainContentRef.current?.offsetWidth ?? window.innerWidth * 0.85) *
      DEFAULT_WEBVIEW_WIDTH_FRACTION,
  });

  const { sendChatMessage } = useCollaborationSession({
    sessionId,
    userId,
    userInfo: { name: userName, color: userColor },
    activeFileId,
    editorInstance: editorInstanceRef.current,
    isSessionActive,
    webViewFileIds: ["index.html", "style.css", "script.js"],
    onStateReceived: useCallback(
      (fileId, content, _revision, participantsFromHook) => {
        setFileContent(fileId, content);
        setRemoteUsers((prev) => ({
          ...prev,
          [fileId]: participantsFromHook,
        }));
      },
      [setFileContent]
    ),
    onOperationReceived: useCallback(
      (fileId, operationData) => {
        const currentActiveFileId = useFileStore.getState().activeFileId;

        if (fileId === currentActiveFileId) {
          const editor = editorInstanceRef.current;
          if (editor) {
            const currentEditorContent = editor.getModel()?.getValue();
            if (currentEditorContent !== undefined) {
              const currentZustandContent =
                useFileStore.getState().fileContents[fileId];
              if (currentEditorContent !== currentZustandContent) {
                setFileContent(fileId, currentEditorContent);
              }
            } else {
              console.warn(
                `[App onOperationReceived] Could not get editor content for active file ${fileId}.`
              );
            }
          } else {
            console.warn(
              `[App onOperationReceived] Editor instance not available for active file ${fileId}.`
            );
          }
        } else {
          const currentZustandContent =
            useFileStore.getState().fileContents[fileId];
          if (currentZustandContent !== undefined) {
            try {
              const operation = operationData;
              const newContent = operation.apply(currentZustandContent);
              if (newContent !== currentZustandContent) {
                setFileContent(fileId, newContent);
              }
            } catch (error) {
              console.error(
                `[App onOperationReceived] Error applying operation to background file ${fileId}:`,
                error,
                operationData
              );
            }
          } else {
            console.warn(
              `[App onOperationReceived] No content found in Zustand for background file ${fileId}. Cannot apply operation.`
            );
          }
        }
      },
      [setFileContent]
    ),
    onRemoteUsersUpdate: useCallback(
      (fileId, updatedUsersInfo: Partial<RemoteUser>[]) => {
        setRemoteUsers((prevRemoteUsers) => {
          let changed = false;
          const nextRemoteUsers = { ...prevRemoteUsers };

          if (!nextRemoteUsers[fileId]) {
            nextRemoteUsers[fileId] = [];
          }

          const usersForDoc = [...(nextRemoteUsers[fileId] || [])];

          updatedUsersInfo.forEach((partialUserUpdate) => {
            if (!partialUserUpdate || partialUserUpdate.id === userId) return;

            const existingUserIndex = usersForDoc.findIndex(
              (u) => u.id === partialUserUpdate.id
            );

            if (existingUserIndex > -1) {
              const existingUser = usersForDoc[existingUserIndex];
              const mergedUser = { ...existingUser, ...partialUserUpdate };

              if (JSON.stringify(existingUser) !== JSON.stringify(mergedUser)) {
                usersForDoc[existingUserIndex] = mergedUser;
                changed = true;
              }
            } else {
              console.warn(
                `[App onRemoteUsersUpdate] Received update for non-existent user ${partialUserUpdate.id} in file ${fileId}. Update:`,
                partialUserUpdate
              );
              usersForDoc.push(partialUserUpdate as RemoteUser);
              changed = true;
            }
          });

          if (changed) {
            nextRemoteUsers[fileId] = usersForDoc;
            return nextRemoteUsers;
          }

          return prevRemoteUsers;
        });
      },
      [userId]
    ),
    onConnectionStatusChange: useCallback(() => {}, []),
    onError: useCallback(
      (error: Error | string) => {
        console.error("[App onError] Collaboration Hook Error:", error);
        alert(
          `Collaboration Error: ${
            error instanceof Error ? error.message : error
          }`
        );
        setIsSessionActive(false);
      },
      [setIsSessionActive]
    ),
    onChatMessageReceived: useCallback((message: ChatMessageType) => {
      setChatMessages((prevMessages) => [...prevMessages, message]);
    }, []),
  });

  // HANDLERS
  const handleEditorDidMount = (
    editorInstance: editor.IStandaloneCodeEditor
  ) => {
    editorInstanceRef.current = editorInstance;
  };

  const handleRunCode = async () => {
    try {
      if (!activeFileId) {
        terminalRef.current?.writeToTerminal("No active file to run.\n");
        return;
      }

      const activeFile = openFiles.find((f) => f.id === activeFileId);
      const contentToRun = fileContents[activeFileId];

      if (!activeFile || contentToRun === undefined) {
        terminalRef.current?.writeToTerminal(
          "Error: Active file data not found.\n"
        );
        return;
      }

      if (!isExecutableLanguage(activeFile.language)) {
        terminalRef.current?.writeToTerminal(
          `Cannot execute files of type '${activeFile.language}'.\n`
        );
        return;
      }

      const requestBody: CodeExecutionRequest = {
        language: activeFile.language,
        version: LANGUAGE_VERSIONS[activeFile.language].version,
        files: [{ content: contentToRun }],
      };

      const response = await axios.post<CodeExecutionResponse>(
        `${import.meta.env.VITE_BACKEND_URL}/api/execute`,
        requestBody,
        {
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
          },
        }
      );

      const executionOutput = response.data.run.stderr
        ? `${response.data.run.stdout}\\nError: ${response.data.run.stderr}`
        : response.data.run.stdout;
      if (executionOutput !== "") {
        terminalRef.current?.writeToTerminal(executionOutput);
      }
    } catch (error) {
      const errorOutput = `Error: ${
        error instanceof Error ? error.message : "Unknown error occurred"
      }`;
      terminalRef.current?.writeToTerminal(errorOutput);
    }
  };

  const handleGlobalPointerUp = useCallback(() => {}, []);

  const handleCodeChange = (newCode: string) => {
    if (!isSessionActive && activeFileId) {
      setFileContent(activeFileId, newCode);
    }
  };

  // View Menu
  const toggleWebView = () => {
    toggleWebViewPanel();
    setIsViewMenuOpen(false);
  };
  const toggleTerminalVisibility = () => {
    toggleTerminalPanel();
    setIsViewMenuOpen(false);
  };

  // Share Menu Handlers
  const toggleShareMenu = () => {
    setIsShareMenuOpen((prev) => {
      const nextOpen = !prev;
      if (nextOpen) {
        if (isSessionActive && generatedShareLink) setShareMenuView("link");
        setIsColorPickerOpen(false);
      } else {
        setIsColorPickerOpen(false);
      }
      return nextOpen;
    });
  };
  const handleNameChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setUserName(event.target.value);
    setIsColorPickerOpen(false);
  };
  const handleColorSelect = (color: string) => {
    setUserColor(color);
    setIsColorPickerOpen(false);
  };
  const handleToggleColorPicker = () => {
    setIsColorPickerOpen((prev) => !prev);
  };

  // Utility to get the find controller
  const getFindController = useCallback(() => {
    return editorInstanceRef.current?.getContribution(
      "editor.contrib.findController"
    );
  }, []);

  // Function to update match info from editor state
  const updateMatchInfoFromController = useCallback(() => {
    const controller = getFindController();
    if (controller) {
      const state = controller.getState();
      const newMatchInfo = {
        currentIndex: state.matchesCount > 0 ? state.currentIndex + 1 : null,
        totalMatches: state.matchesCount || 0,
      };
      setMatchInfo(newMatchInfo); // setMatchInfo is stable
    }
  }, [getFindController]);

  // HANDLERS for Search Panel
  const handleSearchChange = (term: string) => {
    setSearchTerm(term);
  };

  const handleReplaceChange = (value: string) => {
    setReplaceValue(value);
  };

  const handleToggleSearchOption = (optionKey: keyof SearchOptions) => {
    setSearchOptions((prev) => ({ ...prev, [optionKey]: !prev[optionKey] }));
  };

  const handleReplaceAll = () => {
    const editor = editorInstanceRef.current;
    const model = editor?.getModel();

    if (editor && model && activeFileId && searchTerm) {
      const currentSearchOptions = searchOptions;

      const matches = model.findMatches(
        searchTerm,
        true,
        currentSearchOptions.isRegex,
        currentSearchOptions.matchCase,
        currentSearchOptions.wholeWord ? searchTerm : null,
        false
      );

      if (matches.length > 0) {
        const operations = matches.map((match) => ({
          range: match.range,
          text: replaceValue,
          forceMoveMarkers: true,
        }));

        editor.executeEdits("sidebar-replace-all", operations);

        setSearchTerm("");
        setMatchInfo(null);
      } else {
        console.log(
          "[Search Debug] handleReplaceAll: No matches found to replace."
        );
        setSearchTerm("");
        setMatchInfo(null);
      }
    } else {
      console.warn("[Search Debug] handleReplaceAll conditions not met.");
    }
  };

  // Memos
  const htmlFileContent = useMemo(() => {
    return (
      fileContents["index.html"] ||
      "<!DOCTYPE html><html><head></head><body><!-- index.html not loaded --></body></html>"
    );
  }, [fileContents]);

  const cssFileContent = useMemo(() => {
    return fileContents["style.css"] || "/* style.css not loaded */";
  }, [fileContents]);

  const jsFileContent = useMemo(() => {
    return fileContents["script.js"] || "// script.js not loaded";
  }, [fileContents]);

  // Get remote users
  const currentRemoteUsers = useMemo(() => {
    return activeFileId ? remoteUsers[activeFileId] || [] : [];
  }, [remoteUsers, activeFileId]);

  const activeLanguage = useMemo(() => {
    if (!activeFileId) return "plaintext";
    const activeFile = openFiles.find((f) => f.id === activeFileId);
    return activeFile?.language || "plaintext";
  }, [activeFileId, openFiles]);

  const uniqueRemoteParticipants = useMemo(() => {
    const allUsers = Object.values(remoteUsers).flat();
    const uniqueUsersMap = new Map<string, RemoteUser>();
    allUsers.forEach((user) => {
      if (user.id !== userId) {
        uniqueUsersMap.set(user.id, user);
      }
    });
    return Array.from(uniqueUsersMap.values());
  }, [remoteUsers, userId]);

  // Handle sending chat messages
  const handleSendChatMessage = useCallback(
    (message: string) => {
      if (sendChatMessage && message.trim()) {
        sendChatMessage(message);
      }
    },
    [sendChatMessage]
  );

  // Reset chat messages when session changes
  useEffect(() => {
    if (!isSessionActive) {
      setChatMessages([]);
    }
  }, [isSessionActive]);

  // Debug logger
  useEffect(() => {
    console.log(
      `[DEBUG] State changed - isSessionActive: ${isSessionActive}, joinState: ${joinState}`
    );
  }, [isSessionActive, joinState]);

  // Effect to handle editor search AND find widget visibility control
  useEffect(() => {
    const controller = getFindController();
    if (!controller) {
      setMatchInfo(null);
      setIsWidgetForcedHidden(false);
      return;
    }

    if (activeIcon === "search") {
      setIsWidgetForcedHidden(true);

      if (searchTerm) {
        controller.setSearchString(searchTerm);
        controller.start({
          searchString: searchTerm,
          replaceString: replaceValue,
          isRegex: searchOptions.isRegex,
          matchCase: searchOptions.matchCase,
          wholeWord: searchOptions.wholeWord,
          autoFindInSelection: "never",
          seedSearchStringFromSelection: "never",
        });
        updateMatchInfoFromController();
      } else {
        if (controller.getState().searchString !== "") {
          controller.setSearchString("");
        }
        if (editorInstanceRef.current) {
          findResultsDecorationIds.current =
            editorInstanceRef.current.deltaDecorations(
              findResultsDecorationIds.current,
              []
            );
        }
        setMatchInfo(null);
      }
    } else {
      controller.closeFindWidget();
      setTimeout(() => {
        setIsWidgetForcedHidden(false);
      }, 100); // Delay to allow widget to close before unhiding
    }
  }, [
    searchTerm,
    searchOptions,
    replaceValue,
    activeIcon,
    getFindController,
    updateMatchInfoFromController,
    setIsWidgetForcedHidden,
  ]);

  // Effect to control explorer panel visibility based on activeIcon
  useEffect(() => {
    // Open panel if an icon is active and panel is closed
    if (activeIcon && isExplorerCollapsed) {
      toggleExplorerPanel();
    }
    // Close panel if no icon is active and panel is open
    else if (!activeIcon && !isExplorerCollapsed) {
      toggleExplorerPanel();
    }
    // Note: toggleExplorerPanel is stable from useResizablePanel if its dependencies are stable.
    // We only want this effect to run when activeIcon or isExplorerCollapsed changes.
  }, [activeIcon, isExplorerCollapsed, toggleExplorerPanel]);

  // EFFECTS
  useEffect(() => {
    document.addEventListener("pointerup", handleGlobalPointerUp);
    document.addEventListener("pointercancel", handleGlobalPointerUp);
    return () => {
      document.removeEventListener("pointerup", handleGlobalPointerUp);
      document.removeEventListener("pointercancel", handleGlobalPointerUp);
    };
  }, [handleGlobalPointerUp]);

  // JSX
  return (
    <div className="flex flex-col h-screen bg-gradient-to-b from-stone-800 to-stone-600 text-stone-300 overflow-hidden">
      {/* CSS rule now conditional based on parent class */}
      <style>
        {`
          .force-hide-find-widget .monaco-editor .find-widget {
            display: none !important;
          }
        `}
      </style>
      {/* Header */}
      <Header
        isViewMenuOpen={isViewMenuOpen}
        setIsViewMenuOpen={setIsViewMenuOpen}
        toggleWebView={toggleWebView}
        toggleTerminalVisibility={toggleTerminalVisibility}
        isWebViewVisible={!isWebViewCollapsed}
        isTerminalCollapsed={isTerminalCollapsed}
        handleRunCode={handleRunCode}
        isShareMenuOpen={isShareMenuOpen}
        toggleShareMenu={toggleShareMenu}
        shareMenuView={shareMenuView}
        userName={userName}
        userColor={userColor}
        handleNameChange={handleNameChange}
        handleColorSelect={handleColorSelect}
        isColorPickerOpen={isColorPickerOpen}
        handleToggleColorPicker={handleToggleColorPicker}
        handleStartSession={handleStartSession}
        generatedShareLink={generatedShareLink}
        handleCopyShareLink={handleCopyShareLink}
        isSessionActive={isSessionActive}
        uniqueRemoteParticipants={uniqueRemoteParticipants}
        setIsColorPickerOpen={setIsColorPickerOpen}
      />
      {/* Main Content */}
      <div
        ref={mainContentRef}
        className={`flex flex-1 min-h-0 ${
          isWidgetForcedHidden ? "force-hide-find-widget" : ""
        }`}
      >
        {/* Sidebar */}
        <Sidebar
          sidebarContainerRef={sidebarContainerRef}
          explorerPanelRef={explorerPanelRef}
          isExplorerCollapsed={isExplorerCollapsed}
          explorerPanelSize={explorerPanelSize}
          handleExplorerPanelMouseDown={handleExplorerPanelMouseDown}
          toggleExplorerPanel={toggleExplorerPanel}
          openPanelWithIcon={openPanelWithIcon}
          activeIcon={activeIcon}
          setActiveIcon={setActiveIcon}
          handleShareIconClick={handleShareIconClick}
          joinState={joinState}
          sessionId={sessionId}
          userName={userName}
          userColor={userColor}
          isColorPickerOpen={isColorPickerOpen}
          handleNameChange={handleNameChange}
          handleColorSelect={handleColorSelect}
          handleToggleColorPicker={handleToggleColorPicker}
          handleConfirmJoin={handleConfirmJoin}
          activeFileId={activeFileId}
          isSessionActive={isSessionActive}
          handleOpenFile={(fileId) => openFile(fileId, isSessionActive)}
          mockFiles={MOCK_FILES}
          onSearchChange={handleSearchChange}
          onReplaceChange={handleReplaceChange}
          onToggleSearchOption={handleToggleSearchOption}
          replaceValue={replaceValue}
          searchOptions={searchOptions}
          matchInfo={matchInfo}
          onReplaceAll={handleReplaceAll}
          uniqueRemoteParticipants={uniqueRemoteParticipants}
          localUserName={userName}
          localUserColor={userColor}
          onSendMessage={handleSendChatMessage}
          chatMessages={chatMessages}
          userId={userId}
        />
        {/* Code and Terminal Area + Optional WebView  */}
        <MainEditorArea
          editorTerminalAreaRef={editorTerminalAreaRef}
          tabContainerRef={tabContainerRef}
          terminalRef={terminalRef}
          editorInstanceRef={editorInstanceRef}
          handleSwitchTab={switchTab}
          handleCloseTab={closeFile}
          fileContents={fileContents}
          handleCodeChange={handleCodeChange}
          handleEditorDidMount={handleEditorDidMount}
          currentRemoteUsers={currentRemoteUsers}
          localUserId={userId}
          isSessionActive={isSessionActive}
          terminalPanelHeight={terminalPanelHeight}
          isTerminalCollapsed={isTerminalCollapsed}
          handleTerminalPanelMouseDown={handleTerminalPanelMouseDown}
          webViewPanelWidth={webViewPanelWidth}
          handleWebViewPanelMouseDown={handleWebViewPanelMouseDown}
          htmlFileContent={htmlFileContent}
          cssFileContent={cssFileContent}
          jsFileContent={jsFileContent}
          toggleWebView={toggleWebView}
          joinState={joinState}
          tabsHaveOverflow={tabsHaveOverflow}
          onTabsOverflowChange={setTabsHaveOverflow}
        />
      </div>
      {/* Status Bar */}
      <StatusBar
        connectionStatus={isSessionActive ? "connected" : undefined}
        language={activeLanguage}
        line={cursorLine}
        column={cursorColumn}
      />{" "}
      {(isExplorerPanelResizing ||
        isTerminalPanelResizing ||
        isWebViewPanelResizing) && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            zIndex: 9999,
            cursor: document.body.style.cursor,
          }}
        />
      )}
      <Analytics />
    </div>
  );
};

export default App;
