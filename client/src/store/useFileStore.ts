import { create } from "zustand";
import {
  OpenFile,
  EditorLanguageKey,
  SearchOptions,
  MatchInfo,
  CatalogFile,
} from "../types/editor";

const DEFAULT_INITIAL_OPEN_FILE_IDS = [
  "index.html",
  "style.css",
  "script.js",
];

const buildOpenFileState = (
  catalog: Record<string, CatalogFile>,
  preferredOpenIds: string[] = DEFAULT_INITIAL_OPEN_FILE_IDS
) => {
  const sanitizedPreferredIds = preferredOpenIds.filter(
    (id) => catalog[id] !== undefined
  );

  const fallbackPool =
    sanitizedPreferredIds.length > 0
      ? sanitizedPreferredIds
      : Object.keys(catalog);

  const openIds = fallbackPool.slice(0, Math.min(fallbackPool.length, 3));

  const openFiles: OpenFile[] = openIds.map((id) => {
    const fileData = catalog[id];
    if (!fileData) {
      return {
        id,
        name: id,
        language: "plaintext" as EditorLanguageKey,
      };
    }
    return {
      id,
      name: fileData.name,
      language: fileData.language,
    };
  });

  const fileContents: { [id: string]: string } = {};
  openIds.forEach((id) => {
    const fileData = catalog[id];
    if (fileData) {
      fileContents[id] = fileData.content;
    }
  });

  return {
    openFiles,
    fileContents,
    activeFileId: openFiles[0]?.id ?? null,
  };
};

const initialSearchOptions: SearchOptions = {
  matchCase: false,
  wholeWord: false,
  isRegex: false,
  preserveCase: false,
};

const initialDerivedState = buildOpenFileState({});

interface FileState {
  filesCatalog: { [id: string]: CatalogFile };
  openFiles: OpenFile[];
  activeFileId: string | null;
  fileContents: { [id: string]: string };

  draggingId: string | null;
  dropIndicator: { tabId: string | null; side: "left" | "right" | null };

  // Search State
  searchTerm: string;
  replaceTerm: string;
  searchOptions: SearchOptions;
  matchInfo: MatchInfo | null;
}

interface FileActions {
  setOpenFiles: (
    files: OpenFile[] | ((prev: OpenFile[]) => OpenFile[])
  ) => void;
  setActiveFileId: (id: string | null) => void;
  setFileContent: (id: string, content: string) => void;
  setDraggingId: (id: string | null) => void;
  setDropIndicator: (indicator: FileState["dropIndicator"]) => void;
  openFile: (fileId: string, isSessionActive: boolean) => void;
  closeFile: (fileIdToClose: string) => void;
  switchTab: (fileId: string) => void;
  initializeFromCatalog: (
    catalog: { [id: string]: CatalogFile },
    preferredOpenIds?: string[]
  ) => void;

  // Search Actions
  setSearchTerm: (term: string) => void;
  setReplaceTerm: (term: string) => void;
  toggleSearchOption: (option: keyof SearchOptions) => void;
  setMatchInfo: (info: MatchInfo | null) => void;
  resetSearch: () => void;
}

export const useFileStore = create<FileState & FileActions>((set, get) => ({
  filesCatalog: {},
  openFiles: initialDerivedState.openFiles,
  activeFileId: initialDerivedState.activeFileId,
  fileContents: initialDerivedState.fileContents,
  draggingId: null,
  dropIndicator: { tabId: null, side: null },

  // Initial Search State
  searchTerm: "",
  replaceTerm: "",
  searchOptions: initialSearchOptions,
  matchInfo: null,

  setOpenFiles: (files) =>
    set((state) => ({
      openFiles: typeof files === "function" ? files(state.openFiles) : files,
    })),
  setActiveFileId: (id) => set({ activeFileId: id }),
  setFileContent: (id, content) =>
    set((state) => ({
      fileContents: { ...state.fileContents, [id]: content },
    })),
  setDraggingId: (id) => set({ draggingId: id }),
  setDropIndicator: (indicator) => set({ dropIndicator: indicator }),

  switchTab: (fileId) => {
    set({ activeFileId: fileId });
  },

  openFile: (fileId) => {
    const state = get();
    const fileData = state.filesCatalog[fileId];
    if (!fileData) {
      console.error(`Cannot open file: ${fileId} not found in catalog.`);
      return;
    }
    const fileAlreadyOpen = state.openFiles.some((f) => f.id === fileId);

    if (!fileAlreadyOpen) {
      const newOpenFile: OpenFile = {
        id: fileId,
        name: fileData.name,
        language: fileData.language,
      };

      const newStateUpdate: Partial<FileState> = {
        openFiles: [...state.openFiles, newOpenFile],
        activeFileId: fileId,
      };

      // Initialize content for files that don't have content yet
      if (state.fileContents[fileId] === undefined) {
        newStateUpdate.fileContents = {
          ...state.fileContents,
          [fileId]: fileData.content,
        };
      }

      set(newStateUpdate);
    } else {
      // File is already open, just switch to it
      set({ activeFileId: fileId });
    }
  },

  closeFile: (fileIdToClose) => {
    const state = get();
    const indexToRemove = state.openFiles.findIndex(
      (f) => f.id === fileIdToClose
    );

    if (indexToRemove === -1) return;

    let nextActiveId: string | null = state.activeFileId;

    if (state.activeFileId === fileIdToClose) {
      if (state.openFiles.length > 1) {
        const newIndex = Math.max(0, indexToRemove - 1);
        nextActiveId =
          state.openFiles[newIndex]?.id ?? state.openFiles[0]?.id ?? null;
        const remainingFiles = state.openFiles.filter(
          (f) => f.id !== fileIdToClose
        );
        nextActiveId =
          remainingFiles[Math.max(0, indexToRemove - 1)]?.id ??
          remainingFiles[0]?.id ??
          null;
      } else {
        nextActiveId = null;
      }
    }

    // Update state: filter closed file and set new active ID
    set({
      openFiles: state.openFiles.filter((f) => f.id !== fileIdToClose),
      activeFileId: nextActiveId,
    });
  },

  // Search Action Implementations
  setSearchTerm: (term) => set({ searchTerm: term }),
  setReplaceTerm: (term) => set({ replaceTerm: term }),
  toggleSearchOption: (option) =>
    set((state) => ({
      searchOptions: {
        ...state.searchOptions,
        [option]: !state.searchOptions[option],
      },
    })),
  setMatchInfo: (info) => set({ matchInfo: info }),
  resetSearch: () =>
    set({
      searchTerm: "",
      replaceTerm: "",
      matchInfo: null,
      // searchOptions are intentionally not reset here, user might want to keep them
    }),
  initializeFromCatalog: (catalog, preferredOpenIds) => {
    const derivedState = buildOpenFileState(
      catalog,
      preferredOpenIds && preferredOpenIds.length > 0
        ? preferredOpenIds
        : DEFAULT_INITIAL_OPEN_FILE_IDS
    );

    set({
      filesCatalog: catalog,
      openFiles: derivedState.openFiles,
      activeFileId: derivedState.activeFileId,
      fileContents: derivedState.fileContents,
      draggingId: null,
      dropIndicator: { tabId: null, side: null },
      searchTerm: "",
      replaceTerm: "",
      matchInfo: null,
    });
  },
}));
