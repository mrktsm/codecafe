import React from "react";
import {
  VscFiles,
  VscSearch,
  VscAccount,
  VscSettingsGear,
} from "react-icons/vsc";
import { GrChatOption, GrShareOption } from "react-icons/gr";
import JoinSessionPanel from "./JoinSessionPanel";
import ChatPanel from "./ChatPanel";
import SearchPanel from "./SearchPanel";
import SessionParticipantsPanel from "./SessionParticipantsPanel";
import FileExplorerPanel from "./FileExplorerPanel";
import { RemoteUser, ChatMessageType } from "../types/props";
import {
  JoinStateType,
  SearchOptions,
  MatchInfo,
  CatalogFile,
} from "../types/editor";
import { ICON_BAR_WIDTH, EXPLORER_HANDLE_WIDTH } from "../constants/layout";
import { COLORS } from "../constants/colors";

interface SidebarProps {
  sidebarContainerRef: React.RefObject<HTMLDivElement>;
  explorerPanelRef: React.RefObject<HTMLDivElement>;
  isExplorerCollapsed: boolean;
  explorerPanelSize: number;
  handleExplorerPanelMouseDown: (e: React.MouseEvent<HTMLDivElement>) => void;
  toggleExplorerPanel: () => void;
  openPanelWithIcon: (iconName: string) => void;
  activeIcon: string | null;
  setActiveIcon: React.Dispatch<React.SetStateAction<string | null>>;
  joinState: JoinStateType;
  sessionId: string | null;
  userName: string;
  userColor: string;
  isColorPickerOpen: boolean;
  handleNameChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
  handleColorSelect: (color: string) => void;
  handleToggleColorPicker: () => void;
  handleConfirmJoin: () => void;
  isSessionActive: boolean;
  activeFileId: string | null;
  handleOpenFile: (fileId: string) => void;
  fileCatalog: { [key: string]: CatalogFile };
  onSearchChange: (term: string, options: SearchOptions) => void;
  onReplaceChange: (value: string) => void;
  onToggleSearchOption: (optionKey: keyof SearchOptions) => void;
  replaceValue: string;
  searchOptions: SearchOptions;
  matchInfo: MatchInfo | null;
  onReplaceAll: () => void;
  handleShareIconClick: () => void;
  uniqueRemoteParticipants: RemoteUser[];
  localUserName: string;
  localUserColor: string;
  userId: string;
  chatMessages: ChatMessageType[];
  onSendMessage: (message: string) => void;
}

const Sidebar = ({
  sidebarContainerRef,
  explorerPanelRef,
  isExplorerCollapsed,
  explorerPanelSize,
  handleExplorerPanelMouseDown,
  openPanelWithIcon,
  activeIcon,
  setActiveIcon,
  joinState,
  sessionId,
  userName,
  userColor,
  isColorPickerOpen,
  handleNameChange,
  handleColorSelect,
  handleToggleColorPicker,
  handleConfirmJoin,
  isSessionActive,
  activeFileId,
  handleOpenFile,
  fileCatalog,
  onSearchChange,
  onReplaceChange,
  onToggleSearchOption,
  replaceValue,
  searchOptions,
  matchInfo,
  onReplaceAll,
  handleShareIconClick,
  uniqueRemoteParticipants,
  localUserName,
  localUserColor,
  userId,
  chatMessages,
  onSendMessage,
}: SidebarProps) => {
  const handleGenericIconClick = (iconName: string) => {
    if (joinState === "prompting" && activeIcon === "share") {
      openPanelWithIcon(iconName);
      return;
    }

    if (isExplorerCollapsed) {
      openPanelWithIcon(iconName);
    } else {
      if (iconName === activeIcon) {
        setActiveIcon(null);
      } else {
        openPanelWithIcon(iconName);
      }
    }
  };

  return (
    <div
      ref={sidebarContainerRef}
      className="flex flex-shrink-0 h-full relative"
    >
      {/* Icon Bar */}
      <div
        className="bg-stone-800 bg-opacity-60 flex flex-col justify-between py-2 border-r border-stone-600 flex-shrink-0 z-10"
        style={{ width: `${ICON_BAR_WIDTH}px` }}
      >
        {/* Top Icons */}
        <div className="flex flex-col items-center space-y-3">
          <button
            className={`w-full flex justify-center py-1 ${
              activeIcon === "files"
                ? "text-stone-100"
                : "text-stone-500 hover:text-stone-200"
            }`}
            onClick={() => handleGenericIconClick("files")}
          >
            <VscFiles size={24} />
          </button>
          <button
            className={`w-full flex justify-center py-1 ${
              activeIcon === "search"
                ? "text-stone-100"
                : "text-stone-500 hover:text-stone-200"
            }`}
            onClick={() => handleGenericIconClick("search")}
          >
            <VscSearch size={24} />
          </button>
          <button
            className={`w-full flex justify-center py-1 ${
              activeIcon === "share"
                ? "text-stone-100"
                : "text-stone-500 hover:text-stone-200"
            }`}
            onClick={handleShareIconClick}
          >
            <GrShareOption size={26} />
          </button>
          <button
            className={`w-full flex justify-center py-1 ${
              activeIcon === "chat"
                ? "text-stone-100"
                : "text-stone-500 hover:text-stone-200"
            }`}
            onClick={() => handleGenericIconClick("chat")}
          >
            <GrChatOption size={24} />
          </button>
        </div>
        {/* Bottom Icons */}
        <div className="flex flex-col items-center space-y-3">
          <button
            className={`w-full flex justify-center py-1 ${
              activeIcon === "account"
                ? "text-stone-100"
                : "text-stone-500 hover:text-stone-200"
            }`}
            onClick={() => handleGenericIconClick("account")}
          >
            <VscAccount size={24} />
          </button>
          <button
            className={`w-full flex justify-center py-1 ${
              activeIcon === "settings"
                ? "text-stone-100"
                : "text-stone-500 hover:text-stone-200"
            }`}
            onClick={() => handleGenericIconClick("settings")}
          >
            <VscSettingsGear size={24} />
          </button>
        </div>
      </div>

      {/* Main Content Panel Area (Explorer, Search, Chat etc.) */}
      <div
        ref={explorerPanelRef}
        className={`bg-stone-800 bg-opacity-60 overflow-hidden flex flex-col h-full border-r border-stone-600 flex-shrink-0 ${
          !isExplorerCollapsed ? "visible" : "invisible w-0"
        }`}
        style={{ width: `${explorerPanelSize}px` }}
      >
        <>
          {/* File Explorer Panel */}
          <div
            className={`flex-1 flex flex-col overflow-hidden ${
              (activeIcon === "files" || activeIcon === null) &&
              joinState !== "prompting"
                ? ""
                : "hidden"
            }`}
          >
            <FileExplorerPanel
              handleOpenFile={handleOpenFile}
              fileCatalog={fileCatalog}
              activeFileId={activeFileId}
            />
          </div>

          {/* Chat Panel */}
          <div
            className={`flex-1 overflow-hidden ${
              activeIcon === "chat" ? "" : "hidden"
            }`}
          >
            <ChatPanel
              userName={userName}
              userColor={userColor}
              sessionId={sessionId}
              isSessionActive={isSessionActive}
              userId={userId}
              onSendMessage={onSendMessage}
              messages={chatMessages}
            />
          </div>

          {/* Search Panel */}
          <SearchPanel
            activeIcon={activeIcon}
            onExecuteSearch={onSearchChange}
            onExecuteReplaceAll={onReplaceAll}
            matchInfo={matchInfo}
            searchOptions={searchOptions}
            onToggleSearchOption={onToggleSearchOption}
            replaceValue={replaceValue}
            onReplaceChange={onReplaceChange}
          />

          {/* Share Panel: Shows JoinSessionPanel or SessionParticipantsPanel */}
          {activeIcon === "share" && (
            <>
              {joinState === "prompting" ? (
                <JoinSessionPanel
                  userName={userName}
                  userColor={userColor}
                  isColorPickerOpen={isColorPickerOpen}
                  colors={COLORS}
                  onNameChange={handleNameChange}
                  onColorSelect={handleColorSelect}
                  onToggleColorPicker={handleToggleColorPicker}
                  onConfirmJoin={handleConfirmJoin}
                />
              ) : isSessionActive ? (
                <SessionParticipantsPanel
                  key={`${sessionId || "no-session"}-${
                    uniqueRemoteParticipants.length
                  }`}
                  activeIcon={activeIcon}
                  participants={uniqueRemoteParticipants}
                  localUser={{ name: localUserName, color: localUserColor }}
                />
              ) : (
                <div className="flex flex-col h-full bg-stone-800 bg-opacity-60">
                  <div className="pl-4 py-2 text-xs text-stone-400 sticky top-0 bg-stone-800 bg-opacity-60 z-10 flex-shrink-0">
                    PARTICIPANTS
                  </div>
                  <div className="flex-1 overflow-y-auto">
                    <div className="text-center py-10 text-stone-500 text-sm">
                      Join or start a session to view participants.
                    </div>
                  </div>
                </div>
              )}
            </>
          )}

          {/* Account Panel Placeholder */}
          <div
            className={`p-4 text-stone-400 ${
              activeIcon === "account" ? "" : "hidden"
            }`}
          >
            Account Panel (Not Implemented)
          </div>

          {/* Settings Panel Placeholder */}
          <div
            className={`p-4 text-stone-400 ${
              activeIcon === "settings" ? "" : "hidden"
            }`}
          >
            Settings Panel (Not Implemented)
          </div>
        </>
      </div>

      {/* Resizer Handle */}
      {!isExplorerCollapsed && (
        <div
          className="absolute top-0 h-full cursor-col-resize bg-transparent z-20"
          style={{
            width: `${EXPLORER_HANDLE_WIDTH}px`,
            left: `${
              ICON_BAR_WIDTH + explorerPanelSize - EXPLORER_HANDLE_WIDTH / 2
            }px`,
            pointerEvents: "auto",
          }}
          onMouseDown={handleExplorerPanelMouseDown}
        />
      )}
    </div>
  );
};

export default Sidebar;
