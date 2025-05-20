import React from "react";
import { editor } from "monaco-editor";
import { VscFile } from "react-icons/vsc";
import { TerminalRef } from "./TerminalComponent";

import { JoinStateType, EditorLanguageKey } from "../types/editor";
import { RemoteUser } from "../types/props";
import CodeEditor from "./CodeEditor";
import TerminalComponent from "./TerminalComponent";
import WebViewPanel from "./WebViewPanel";
import FileTabs from "./FileTabs";
import {
  editorLanguageMap,
  languageIconMap,
  languageColorMap,
  defaultIconColor,
} from "../constants/mappings";
import {
  TERMINAL_HANDLE_HEIGHT,
  WEBVIEW_HANDLE_GRAB_WIDTH,
} from "../constants/layout";
import { useFileStore } from "../store/useFileStore";

interface MainEditorAreaProps {
  // Refs
  editorTerminalAreaRef: React.RefObject<HTMLDivElement>;
  tabContainerRef: React.RefObject<HTMLDivElement>;
  terminalRef: React.RefObject<TerminalRef>;
  editorInstanceRef: React.MutableRefObject<editor.IStandaloneCodeEditor | null>;

  // Editor
  fileContents: { [id: string]: string };
  handleCodeChange: (newCode: string) => void;
  handleEditorDidMount: (editorInstance: editor.IStandaloneCodeEditor) => void;
  currentRemoteUsers: RemoteUser[];
  localUserId: string;

  // Tab operations
  handleSwitchTab: (fileId: string) => void;
  handleCloseTab: (fileId: string) => void;

  // Terminal Resizing
  terminalPanelHeight: number;
  isTerminalCollapsed: boolean;
  handleTerminalPanelMouseDown: (e: React.MouseEvent<HTMLDivElement>) => void;

  // WebView Resizing & Content
  webViewPanelWidth: number;
  handleWebViewPanelMouseDown: (e: React.MouseEvent<HTMLDivElement>) => void;
  htmlFileContent: string;
  cssFileContent: string;
  jsFileContent: string;
  toggleWebView: () => void;
  isSessionActive: boolean;
  joinState: JoinStateType;
  tabsHaveOverflow: boolean;
  onTabsOverflowChange: (hasOverflow: boolean) => void;
}

const MainEditorArea = ({
  editorTerminalAreaRef,
  tabContainerRef,
  terminalRef,
  fileContents,
  handleCodeChange,
  handleEditorDidMount,
  currentRemoteUsers,
  localUserId,
  handleSwitchTab,
  handleCloseTab,
  terminalPanelHeight,
  isTerminalCollapsed,
  handleTerminalPanelMouseDown,
  webViewPanelWidth,
  handleWebViewPanelMouseDown,
  htmlFileContent,
  cssFileContent,
  jsFileContent,
  toggleWebView,
  isSessionActive,
  joinState,
  tabsHaveOverflow,
  onTabsOverflowChange,
}: MainEditorAreaProps) => {
  const { openFiles, activeFileId } = useFileStore();

  // Find the active file object
  const activeFile = openFiles.find((f) => f.id === activeFileId);

  let ActiveIconComponent: React.ComponentType<React.SVGProps<SVGSVGElement>> =
    VscFile; // Default icon
  let activeIconColor = defaultIconColor; // Default color

  if (activeFile) {
    ActiveIconComponent =
      languageIconMap[activeFile.language as EditorLanguageKey] || VscFile;
    activeIconColor =
      languageColorMap[activeFile.language as EditorLanguageKey] ||
      defaultIconColor;
  }

  return (
    <div className={`flex flex-1 min-w-0 relative`}>
      <div
        ref={editorTerminalAreaRef}
        className="flex-1 flex flex-col relative overflow-x-hidden min-w-0"
      >
        {/* Tabs */}
        <FileTabs
          tabContainerRef={tabContainerRef}
          onOverflowChange={onTabsOverflowChange}
          onSwitchTab={handleSwitchTab}
          onCloseTab={handleCloseTab}
        />

        {/* Breadcrumbs Area */}
        <div className="h-6 flex-shrink-0 bg-neutral-900 flex items-center px-2 text-sm text-stone-400 overflow-hidden whitespace-nowrap">
          {activeFile ? (
            <React.Fragment>
              {/* File Icon and Name */}
              <ActiveIconComponent
                size={16}
                className={`mr-1 flex-shrink-0 ${activeIconColor}`}
              />
              <span className="text-stone-400">{activeFile.name}</span>
            </React.Fragment>
          ) : (
            <span>{/* No file selected */}</span>
          )}
        </div>

        {/* Code Editor Area */}
        <div className="flex-1 overflow-auto font-mono text-sm relative bg-neutral-900 min-h-0">
          {joinState === "prompting" ? (
            <div className="flex items-center justify-center h-full text-stone-500">
              Enter your details in the sidebar to join the session...
            </div>
          ) : activeFileId && openFiles.find((f) => f.id === activeFileId) ? (
            <CodeEditor
              theme="codeCafeTheme"
              language={
                editorLanguageMap[
                  openFiles.find((f) => f.id === activeFileId)?.language ||
                    "plaintext"
                ]
              }
              showLineNumbers={true}
              code={fileContents[activeFileId] ?? "// Loading..."}
              onCodeChange={handleCodeChange}
              onEditorDidMount={handleEditorDidMount}
              users={currentRemoteUsers}
              localUserId={localUserId}
              isSessionActive={isSessionActive}
            />
          ) : (
            <div className="flex items-center justify-center h-full text-stone-500">
              Select a file to start editing.
            </div>
          )}
        </div>

        {/* Terminal Resizer */}
        <div
          className={`w-full bg-stone-700 flex-shrink-0 ${
            isTerminalCollapsed
              ? "cursor-pointer hover:bg-stone-500"
              : "cursor-row-resize hover:bg-stone-600 active:bg-stone-500"
          }`}
          style={{ height: `${TERMINAL_HANDLE_HEIGHT}px` }}
          onMouseDown={handleTerminalPanelMouseDown}
        />

        {/* Terminal Panel */}
        <div
          className={`bg-neutral-900 bg-opacity-90 flex flex-col border-t border-stone-600 flex-shrink-0 ${
            isTerminalCollapsed ? "hidden" : "flex"
          }`}
          style={{ height: `${terminalPanelHeight}px` }}
        >
          <div className="flex bg-stone-800 py-1 text-sm flex-shrink-0">
            <div className="px-4 py-1 text-stone-400 text-xs">TERMINAL</div>
          </div>
          <div className="flex-1 px-4 pt-2 font-mono text-sm overflow-hidden min-h-0">
            <TerminalComponent ref={terminalRef} height={terminalPanelHeight} />
          </div>
        </div>
      </div>

      {/* Invisible WebView Resizer Handle */}
      {webViewPanelWidth > 0 && (
        <div
          className="absolute cursor-col-resize bg-transparent z-20"
          style={{
            width: `${WEBVIEW_HANDLE_GRAB_WIDTH}px`,
            left: `calc(100% - ${webViewPanelWidth}px - ${
              WEBVIEW_HANDLE_GRAB_WIDTH / 2
            }px)`,
            top: tabsHaveOverflow ? "0px" : "33px",
            height: `calc(100% - ${tabsHaveOverflow ? "0px" : "33px"}`,
          }}
          onMouseDown={handleWebViewPanelMouseDown}
        />
      )}

      {/* WebView Panel */}
      {webViewPanelWidth > 0 && (
        <div
          className={`flex-shrink-0 overflow-hidden bg-stone-800 relative 
                     before:content-[''] before:absolute before:left-0 before:bottom-0 before:w-px before:bg-stone-600
                     ${
                       tabsHaveOverflow ? "before:top-0" : "before:top-[33px]"
                     }`}
          style={{ width: `${webViewPanelWidth}px` }}
        >
          <WebViewPanel
            htmlContent={htmlFileContent}
            cssContent={cssFileContent}
            jsContent={jsFileContent}
            onClose={toggleWebView}
          />
        </div>
      )}
    </div>
  );
};

export default MainEditorArea;
