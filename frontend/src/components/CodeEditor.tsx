import { useRef, useEffect } from "react";
import { Editor, loader } from "@monaco-editor/react";
import * as monaco from "monaco-editor";

interface User {
  id: string;
  name: string;
  color: string;
  cursorPosition: {
    lineNumber: number;
    column: number;
  };
  selection?: {
    startLineNumber: number;
    startColumn: number;
    endLineNumber: number;
    endColumn: number;
  };
}

interface CursorData {
  cursorPosition: {
    lineNumber: number;
    column: number;
  };
  selection: {
    startLineNumber: number;
    startColumn: number;
    endLineNumber: number;
    endColumn: number;
  } | null;
}

interface CodeEditorProps {
  onCodeChange: (code: string) => void;
  users?: User[];
  onCursorPositionChange?: (lineNumber: number) => void;
  code?: string;
  sendCursorData?: (cursorData: CursorData) => void;
}

const CodeEditor: React.FC<CodeEditorProps> = ({
  onCodeChange,
  users = [],
  onCursorPositionChange,
  code,
  sendCursorData,
}) => {
  const editorRef = useRef<any>(null);
  const decorationsRef = useRef<string[]>([]);
  const isUpdatingRef = useRef(false);
  const styleSheetRef = useRef<HTMLStyleElement | null>(null);

  // Initialize Monaco theme
  useEffect(() => {
    loader.init().then((monaco) => {
      monaco.editor.defineTheme("transparentTheme", {
        base: "vs-dark",
        inherit: true,
        rules: [],
        colors: {
          "editor.background": "#00000000",
          "editorGutter.background": "#00000000",
          "minimap.background": "#00000000",
        },
      });
    });
  }, []);

  // Update styles whenever users change
  useEffect(() => {
    // Remove old stylesheet if it exists
    if (styleSheetRef.current) {
      styleSheetRef.current.remove();
    }

    // Create new stylesheet
    const styleSheet = document.createElement("style");
    styleSheet.textContent = `
      .monaco-editor {
        border: none !important;
      }
      ${users
        .map(
          (user) => `
        @keyframes blink-${user.id} {
          0%, 49% { opacity: 1; }
          50%, 99% { opacity: 0; }
          100% { opacity: 1; }
        }

        .user-${user.id}-selection {
          background-color: ${user.color}33 !important;
          border: 1px solid ${user.color}66 !important;
        }
        .user-${user.id}-cursor {
          border-left: 2px solid ${user.color} !important;
          height: 20px !important;
          margin-left: -1px !important;
          animation: blink-${user.id} 1000ms step-end infinite;
        }
        .user-${user.id}-label {
          background-color: ${user.color} !important;
          color: white !important;
          padding: 2px 6px !important;
          border-radius: 3px !important;
          font-size: 12px !important;
          font-family: system-ui !important;
          position: absolute !important;
          top: -20px !important;
          white-space: nowrap !important;
          z-index: 1 !important;
        }
      `
        )
        .join("\n")}
    `;
    document.head.appendChild(styleSheet);
    styleSheetRef.current = styleSheet;

    // Update decorations if editor is mounted
    if (editorRef.current) {
      updateDecorations();
    }
  }, [users]);

  // Handle code updates
  useEffect(() => {
  if (editorRef.current && code !== undefined) {
    const currentValue = editorRef.current.getValue();
    if (currentValue !== code && !isUpdatingRef.current) {
      // Save the current view state (includes selection and scroll)
      const viewState = editorRef.current.saveViewState();
      isUpdatingRef.current = true;
      editorRef.current.setValue(code);
      // Restore the view state if available
      if (viewState) {
        editorRef.current.restoreViewState(viewState);
      }
      isUpdatingRef.current = false;
    }
  }
}, [code]);

  const updateDecorations = () => {
    if (!editorRef.current) return;

    const decorations = users.flatMap((user) => {
      const decorationArray = [];

      // Add selection decoration
      if (user.selection) {
        decorationArray.push({
          range: new monaco.Range(
            user.selection.startLineNumber,
            user.selection.startColumn,
            user.selection.endLineNumber,
            user.selection.endColumn
          ),
          options: {
            className: `user-${user.id}-selection`,
            hoverMessage: { value: `Selected by ${user.name}` },
          },
        });
      }

      // Add cursor decoration
      if (user.cursorPosition) {
        decorationArray.push({
          range: new monaco.Range(
            user.cursorPosition.lineNumber,
            user.cursorPosition.column,
            user.cursorPosition.lineNumber,
            user.cursorPosition.column
          ),
          options: {
            className: `user-${user.id}-cursor`,
            beforeContentClassName: "cursor-label",
            before: {
              content: user.name,
              inlineClassName: `user-${user.id}-label`,
            },
          },
        });
      }

      return decorationArray;
    });

    // Update decorations
    decorationsRef.current = editorRef.current.deltaDecorations(
      decorationsRef.current,
      decorations
    );
  };

  const handleEditorDidMount = (editor: any) => {
    editorRef.current = editor;

    // Set up cursor position change handler
    editor.onDidChangeCursorPosition(
      (e: monaco.editor.ICursorPositionChangedEvent) => {
        if (isUpdatingRef.current) return;

        const position = e.position;
        const selection = editor.getSelection();

        onCursorPositionChange?.(position.lineNumber);

        sendCursorData?.({
          cursorPosition: {
            lineNumber: position.lineNumber,
            column: position.column,
          },
          selection: selection
            ? {
                startLineNumber: selection.startLineNumber,
                startColumn: selection.startColumn,
                endLineNumber: selection.endLineNumber,
                endColumn: selection.endColumn,
              }
            : null,
        });
      }
    );

    // Initial decoration update
    updateDecorations();
  };

  const handleEditorChange = (value: string | undefined) => {
    if (!value || isUpdatingRef.current) return;
    onCodeChange(value);
  };

  return (
    <div className="h-full w-full">
      <Editor
        height="100%"
        width="100%"
        theme="transparentTheme"
        defaultLanguage="javascript"
        value={code}
        onChange={handleEditorChange}
        onMount={handleEditorDidMount}
        options={{
          fontSize: 16,
          lineHeight: 20,
          minimap: { enabled: false },
          wordWrap: "on",
          cursorBlinking: "blink",
          cursorStyle: "line",
          scrollBeyondLastLine: false,
          scrollbar: {
            handleMouseWheel: false,
            verticalScrollbarSize: 0,
            verticalSliderSize: 0,
          },
        }}
        className="monaco-editor"
      />
    </div>
  );
};

export default CodeEditor;
