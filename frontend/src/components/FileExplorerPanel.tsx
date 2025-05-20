import { useState } from "react";
import { VscFile, VscChevronDown, VscChevronRight } from "react-icons/vsc";
import {
  languageIconMap,
  languageColorMap,
  defaultIconColor,
} from "../constants/mappings";
import { EditorLanguageKey } from "../types/editor";

interface MockFile {
  name: string;
  language: EditorLanguageKey;
  // Add other properties as needed
}

// Props for FileExplorerPanel - initially minimal, might adjust
interface FileExplorerPanelProps {
  isSessionActive: boolean;
  handleOpenFile: (fileId: string) => void;
  mockFiles: { [key: string]: MockFile };
  activeFileId: string | null;
}

const FileExplorerPanel = ({
  handleOpenFile,
  mockFiles,
  activeFileId,
}: FileExplorerPanelProps) => {
  const [isProjectExpanded, setIsProjectExpanded] = useState(true);

  const toggleProjectFolder = () => {
    setIsProjectExpanded(!isProjectExpanded);
  };

  return (
    <div className="flex-1 flex flex-col">
      <div className="pl-4 py-2 text-xs text-stone-400 sticky top-0 bg-stone-800 bg-opacity-95 z-10 flex-shrink-0">
        EXPLORER
      </div>
      <div className="w-full h-full overflow-y-auto flex-grow">
        <button
          className="flex items-center text-xs py-1 cursor-pointer w-full hover:bg-stone-700 pl-1"
          onClick={toggleProjectFolder}
        >
          <div
            className="flex items-center justify-center mr-1"
            style={{ width: "1rem" }}
          >
            {isProjectExpanded ? (
              <VscChevronDown
                size={16}
                className="flex-shrink-0 text-stone-500"
              />
            ) : (
              <VscChevronRight
                size={16}
                className="flex-shrink-0 text-stone-500"
              />
            )}
          </div>
          <span className="font-medium text-stone-500 truncate">
            MY CODECAFE PROJECT
          </span>
        </button>

        {isProjectExpanded && (
          <div className="relative">
            <div className="absolute top-0 bottom-0 left-[12px] w-px bg-stone-600/50 z-0"></div>

            {Object.entries(mockFiles).map(([id, file]) => {
              const IconComponent =
                languageIconMap[file.language as EditorLanguageKey] || VscFile;
              const iconColor =
                languageColorMap[file.language as EditorLanguageKey] ||
                defaultIconColor;
              return (
                <div
                  key={id}
                  className={`relative flex items-center text-sm py-1 cursor-pointer w-full pl-4 z-10 ${
                    activeFileId === id
                      ? "bg-stone-600/50 shadow-[inset_0_1px_0_#78716c,inset_0_-1px_0_#78716c] hover:bg-stone-600/50"
                      : "hover:bg-stone-700/50"
                  }`}
                  onClick={() => handleOpenFile(id)}
                  title={file.name}
                >
                  <IconComponent
                    size={18}
                    className={`mr-1 flex-shrink-0 ${iconColor}`}
                  />
                  <span
                    className={`w-full truncate ${
                      activeFileId === id ? "text-stone-100" : "text-stone-400"
                    }`}
                  >
                    {file.name}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export default FileExplorerPanel;
