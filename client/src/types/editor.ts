import { LANGUAGE_VERSIONS } from "../constants/languageVersions";

export interface CodeFile {
  content: string;
}

export interface CodeExecutionRequest {
  language: string;
  version: string;
  files: CodeFile[];
}

export interface CodeExecutionResponse {
  run: {
    stdout: string;
    stderr: string;
  };
}
export interface TerminalRef {
  writeToTerminal: (text: string) => void;
  fit: () => void;
}

export type ExecutableLanguageKey = keyof typeof LANGUAGE_VERSIONS; // Languages the backend can run
export type EditorLanguageKey =
  | ExecutableLanguageKey
  | "css"
  | "html"
  | "plaintext"
  | "json"
  | "markdown";

export type JoinStateType = "idle" | "prompting" | "joined";

export interface OpenFile {
  id: string;
  name: string;
  language: EditorLanguageKey;
}

export interface CatalogFile {
  name: string;
  language: EditorLanguageKey;
  content: string;
}

export interface TerminalHandle {
  writeToTerminal: (output: string) => void;
  clear: () => void;
  fit: () => void;
}

export interface SearchOptions {
  matchCase: boolean;
  wholeWord: boolean;
  isRegex: boolean;
  preserveCase: boolean;
}

export interface MatchInfo {
  currentIndex: number | null;
  totalMatches: number;
}

export interface SearchPanelProps {
  activeIcon: string | null;
  onExecuteSearch: (term: string, options: SearchOptions) => void;
  onExecuteReplaceAll: () => void;
}

export interface SortableTabProps {
  file: OpenFile;
  activeFileId: string | null;
  draggingId: string | null;
  dropIndicatorSide: "left" | "right" | null;
  IconComponent: React.ComponentType<{ size?: number; className?: string }>;
  iconColor: string;
  onSwitchTab?: (fileId: string) => void;
  onCloseTab?: (fileId: string) => void;
}
