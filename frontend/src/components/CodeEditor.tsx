import { useRef, useEffect } from "react";
import { Editor, loader, OnChange, OnMount } from "@monaco-editor/react";
import { CodeEditorProps } from "../types/props";
import * as monaco from "monaco-editor";
import { THEMES } from "../constants/themes";

import { IDisposable } from "monaco-editor";
import {
  editorOptions,
  createCursorDecoration,
  createSelectionDecoration,
} from "../utils/editorUtils";

const CodeEditor = ({
  onCodeChange,
  users = [],
  code,
  language,
  theme,
  onEditorDidMount,
  localUserId,
  isSessionActive = false,
}: CodeEditorProps) => {
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const styleSheetRef = useRef<HTMLStyleElement | null>(null);
  const decorationsRef = useRef<string[]>([]);

  useEffect(() => {
    // console.log("[CodeEditor] Received users prop:", users);
  }, [users]);

  // Initialize Monaco theme
  useEffect(() => {
    loader.init().then((monaco) => {
      Object.entries(THEMES).forEach(([themeName, themeConfig]) => {
        monaco.editor.defineTheme(themeName, themeConfig.config);
      });

      monaco.editor.setTheme(theme || "");
    });
  }, [theme]);

  // Function to apply decorations based on the users prop
  const updateDecorations = () => {
    if (!editorRef.current) return;

    const model = editorRef.current.getModel();
    if (!model) {
      // console.warn(
      // "[CodeEditor updateDecorations] Cannot get model from editor."
      // );
      return;
    }

    // const modelUri = model.uri.toString();
    // console.log(
    // `[CodeEditor updateDecorations] Applying decorations for model URI: ${modelUri}, Raw Users Prop:`,
    // JSON.stringify(users)
    // );
    // console.log(`[CodeEditor updateDecorations] Local User ID: ${localUserId}`);

    const remoteUsersToDecorate = users.filter(
      (user) => user.id !== localUserId
    );
    // console.log(
    // `[CodeEditor updateDecorations] Filtered Remote Users to Decorate (${remoteUsersToDecorate.length}):`,
    // JSON.stringify(remoteUsersToDecorate)
    // );

    const decorations: monaco.editor.IModelDeltaDecoration[] = [];

    remoteUsersToDecorate.forEach((user) => {
      // console.log(
      // `[CodeEditor updateDecorations] Processing User: ${user.id} (${user.name})`,
      // `CursorPos: ${JSON.stringify(user.cursorPosition)}`,
      // `Selection: ${JSON.stringify(user.selection)}`
      // );

      const cursorDecoration = createCursorDecoration(user, model);
      const selectionDecoration = createSelectionDecoration(user, model);

      if (cursorDecoration) {
        decorations.push(cursorDecoration);
      }
      if (selectionDecoration) {
        decorations.push(selectionDecoration);
      }
    });

    // console.log(
    // `[CodeEditor updateDecorations] Generated Decorations array before applying (${decorations.length}):`,
    // JSON.stringify(decorations)
    // );

    // Apply the decorations
    try {
      const decorationIds = editorRef.current.deltaDecorations(
        decorationsRef.current,
        decorations
      );
      decorationsRef.current = decorationIds;
      // console.log(
      // `[CodeEditor updateDecorations] Applied Decorations to ${modelUri}, IDs:`,
      // decorationIds
      // );
    } catch (error) {
      console.error(
        "[CodeEditor updateDecorations] Error applying decorations:",
        error
      );
      decorationsRef.current = editorRef.current.deltaDecorations(
        decorationsRef.current,
        []
      );
    }
  };

  useEffect(() => {
    // Create and inject a style sheet for user decorations
    if (styleSheetRef.current) {
      styleSheetRef.current.remove();
    }

    const styleSheet = document.createElement("style");
    styleSheet.textContent = `
      .monaco-editor {
        border: none !important;
      }

      /* Remove shadows from common widgets */
      .monaco-editor .find-widget,
      .monaco-editor .suggest-widget,
      .monaco-editor .monaco-hover,
      .monaco-editor .parameter-hints-widget {
          box-shadow: none !important;
          border: 1px solid #404040 !important; /* Optional: Add a subtle border instead */
      }

      /* Remove shadow from sticky scroll header */
      .monaco-editor .header-wrapper {
          box-shadow: none !important;
      }

      ${users
        // Filter out the local user before generating styles
        .filter((user) => user.id !== localUserId)
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

    if (editorRef.current) {
      updateDecorations(); // <-- Make sure this is called
    }

    return () => {
      if (styleSheetRef.current) {
        styleSheetRef.current.remove();
        styleSheetRef.current = null;
      }
    };
  }, [users, localUserId, updateDecorations]);

  // Editor Mount Handler
  const handleEditorDidMount: OnMount = (editor) => {
    editorRef.current = editor;
    onEditorDidMount?.(editor);

    // Cursor/Selection Changes
    let cursorListener: IDisposable | null = null;
    let selectionListener: IDisposable | null = null;
    cursorListener = editor.onDidChangeCursorPosition(() => {});
    selectionListener = editor.onDidChangeCursorSelection(() => {});

    updateDecorations();

    editor.focus();

    return () => {
      cursorListener?.dispose();
      selectionListener?.dispose();
    };
  };

  const handleEditorChange: OnChange = (value, event) => {
    // Only call the prop for non-OT updates
    if (!isSessionActive && value !== undefined) {
      onCodeChange(value, event.changes);
    }
  };

  return (
    <div className="h-full w-full">
      <Editor
        height="100%"
        width="100%"
        language={language}
        theme={theme}
        value={code}
        options={editorOptions}
        onMount={handleEditorDidMount}
        onChange={handleEditorChange}
        loading={<div>Loading Editor...</div>}
      />
    </div>
  );
};

export default CodeEditor;
