import { useEffect, useRef, useState, useCallback } from "react";
import axios from "axios";
import CodeEditor from "./components/CodeEditor";
import Terminal from "./components/Terminal";
import { Theme } from "@radix-ui/themes";
import "react-resizable/css/styles.css";
import SockJS from "sockjs-client";
import Stomp from "stompjs";
import { VscRunAll } from "react-icons/vsc";
import { VscSettings } from "react-icons/vsc";
import { IoStarOutline } from "react-icons/io5";
import { IoStar } from "react-icons/io5";
import SlideMenu from "./components/SlideMenu";
import { debounce } from "lodash";
import ReactLoading from "react-loading";
import ShareProfile from "./components/ShareProfile";
import SettingsWindow from "./components/SettingsWindow";
import {
  TextOperation,
  TextOperationManager,
  OperationAck,
  VersionVector,
} from "./TextOperationSystem";
import { User } from "./types/user";
import { CodeExecutionRequest, CodeExecutionResponse } from "./types/code";
import { CursorData } from "./types/cursorData";
import { LANGUAGE_VERSIONS } from "./constants/languageVersions";
import { THEMES } from "./constants/themes";
import { simulateRapidTyping } from "./simulateRapidTyping";
import { v4 as uuidv4 } from "uuid";

const App = () => {
  const [code, setCode] = useState<string>("// Hello there");
  const [editorHeight, setEditorHeight] = useState(window.innerHeight);
  const [users, setUsers] = useState<User[]>([]);
  // In App.js
  const [localVersionVector, setLocalVersionVector] = useState<{
    [userId: string]: number;
  }>({});
  // const [pendingLocalChanges, setPendingLocalChanges] = useState<string | null>(
  //   null
  // );
  // const pendingLocalChangesRef = useRef<string | null>(null);
  const [isEditorLoading, setIsEditorLoading] = useState(true);
  const codeCafeRef = useRef<HTMLDivElement | null>(null);
  const [isSessionActive, setIsSessionActive] = useState(false);
  const [isSessionCreator, setIsSessionCreator] = useState(false);
  const [editorLanguage, setEditorLanguage] =
    useState<keyof typeof LANGUAGE_VERSIONS>("javascript");

  const [id] = useState<string>(
    () => Date.now().toString() + Math.random().toString(36).substring(2)
  );
  const [name, setName] = useState<string>(Date.now().toString());
  const [displayName, setDisplayName] = useState(""); // For UI updates
  const [color, setColor] = useState<string>(getRandomColor());
  const [starredEnabled, setStarredEnabled] = useState<boolean>(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [theme, setTheme] = useState<keyof typeof THEMES>("codeCafeTheme");

  const [fontSize, setFontSize] = useState<string>("16");
  const [wordWrap, setWordWrap] = useState<boolean>(true);
  const [showLineNumbers, setShowLineNumbers] = useState(true);

  const [sessionId, setSessionId] = useState<string | null>(null);
  const [isJoiningSession, setIsJoiningSession] = useState<boolean>(false);
  const [sessionCreatorName, setSessionCreatorName] = useState<string>("");
  const operationManagerRef = useRef<TextOperationManager | null>(null);
  const editorRef = useRef<any>(null);

  useEffect(() => {
    console.log("Font size changed to:", fontSize);
  }, [fontSize]);

  const nameRef = useRef(name);
  const colorRef = useRef(color);

  useEffect(() => {
    nameRef.current = name;
  }, [name]);

  useEffect(() => {
    colorRef.current = color;
  }, [color]);

  useEffect(() => {
    console.log(name);
  }, [name]);

  function getRandomColor() {
    let letters = "0123456789ABCDEF";
    let color = "#";
    for (let i = 0; i < 6; i++) {
      color += letters[Math.floor(Math.random() * 16)];
    }
    return color;
  }

  // const id = Date.now().toString();
  // const name = Date.now().toString();

  const stompClientRef = useRef<Stomp.Client | null>(null);

  // const socket = new SockJS("http://localhost:8080/ws");
  // const stompClient = Stomp.over(socket);

  const [isLoading, setIsLoading] = useState<boolean>(false);
  const terminalRef = useRef<{ writeToTerminal: (text: string) => void }>(null);
  const codeRef = useRef(code);
  useEffect(() => {
    codeRef.current = code;
  }, [code]);

  const handleEditorDidMount = (editor: any) => {
    editorRef.current = editor;
    // Initialize the TextOperationManager
    if (!operationManagerRef.current && editorRef.current) {
      operationManagerRef.current = new TextOperationManager(
        editorRef.current,
        id,
        localVersionVector,
        sendOperation
      );
    }
  };

  const sendOperation = useCallback(
    (operation: TextOperation) => {
      if (stompClientRef.current?.connected) {
        // Generate a unique ID for the operation
        const operationId = `${id}-${Date.now()}-${Math.random()
          .toString(36)
          .substring(2, 9)}`;

        const operationToSend = {
          ...operation,
          id: operationId,
        };

        console.log("Sending operation to server:", operationToSend);

        stompClientRef.current.send(
          "/app/operation",
          {},
          JSON.stringify(operationToSend)
        );
      } else {
        console.warn("Cannot send operation: session inactive or disconnected");
      }
    },
    [isSessionActive, id]
  );

  const handleCodeChange = (newCode: string) => {
    if (code === newCode) return;
    setCode(newCode);
  };

  // useEffect(() => {
  //   pendingLocalChangesRef.current = pendingLocalChanges;
  // }, [pendingLocalChanges]);

  // Update debouncedSendCursor to maintain previous selection
  // Add this state to track the local selection
  // const [currentSelection, setCurrentSelection] =
  //   useState<CursorData["selection"]>(null);

  // Then modify the debouncedSendCursor function
  const debouncedSendCursor = useCallback(
    debounce((cursorData: CursorData) => {
      const message = {
        user: {
          id: id,
          name: nameRef.current,
          color: colorRef.current,
          cursorPosition: cursorData.cursorPosition,
          // Use local state instead of depending on users array
          selection: cursorData.selection,
        },
      };

      if (stompClientRef.current?.connected) {
        // console.log("NAMES: ", name, displayName);
        // console.log("Sending cursor data", message);
        stompClientRef.current.send("/app/cursor", {}, JSON.stringify(message));
      }
    }, 25),
    [isSessionActive, name, displayName, color]
  );

  const sendCursorData = (cursorData: CursorData) => {
    debouncedSendCursor(cursorData); // Use debounced update for server communication
  };

  // Store sendOperation in a ref to make it accessible
  const sendOperationRef = useRef<(operation: TextOperation) => void>(() => {
    console.error("sendOperation not initialized yet");
  });

  const pendingOperationsRef = useRef<
    Record<
      string,
      {
        operation: TextOperation;
        timestamp: number;
        retries: number;
      }
    >
  >({});

  // Enhanced version of your client-side WebSocket setup
  useEffect(() => {
    if (isSessionActive) {
      const socket = new SockJS("http://localhost:8080/ws");
      const stompClient = Stomp.over(socket);

      // Create retry mechanism for pending operations
      const retryInterval = setInterval(() => {
        const now = Date.now();
        const pendingOps = pendingOperationsRef.current;

        Object.entries(pendingOps).forEach(([id, data]) => {
          if (now - data.timestamp > 3000 && data.retries < 3) {
            console.log(
              `Retrying operation ${id}, attempt ${data.retries + 1}`
            );
            if (stompClientRef.current?.connected) {
              stompClientRef.current.send(
                "/app/operation",
                {},
                JSON.stringify(data.operation)
              );
              pendingOperationsRef.current[id] = {
                ...data,
                retries: data.retries + 1,
                timestamp: now,
              };
            }
          } else if (data.retries >= 3) {
            if (stompClientRef.current?.connected) {
              stompClientRef.current.send(
                "/app/operation-status",
                {},
                JSON.stringify({
                  operationId: id,
                  userId: id,
                })
              );
            }
          }
        });
      }, 5000);

      stompClient.connect({}, function (frame: any) {
        console.log("Connected: " + frame);
        stompClientRef.current = stompClient;

        // Define sendOperation and assign it to the ref
        const sendOperation = (operation: TextOperation) => {
          if (stompClientRef.current?.connected) {
            if (!operation.id) {
              console.error("Operation missing ID, generating one:", operation);
              operation.id = uuidv4(); // Ensure every operation has an ID
            }
            pendingOperationsRef.current[operation.id] = {
              operation,
              timestamp: Date.now(),
              retries: 0,
            };
            stompClientRef.current.send(
              "/app/operation",
              {},
              JSON.stringify(operation)
            );
          } else {
            console.error("Cannot send operation - not connected");
            // Queue for when connection is restored (TODO: implement queue)
          }
        };
        sendOperationRef.current = sendOperation;

        // Subscribe to operations
        stompClient.subscribe("/topic/operations", function (message: any) {
          const operation = JSON.parse(message.body) as TextOperation;
          console.log("Received operation:", operation);
          if (operationManagerRef.current) {
            operationManagerRef.current.applyOperation(operation);
          }
        });

        // Subscribe to operation acknowledgments
        stompClient.subscribe("/topic/operation-ack", function (message: any) {
          const ack = JSON.parse(message.body) as OperationAck;
          console.log("Received operation acknowledgment:", ack);
          if (pendingOperationsRef.current[ack.operationId]) {
            delete pendingOperationsRef.current[ack.operationId];
          }
          if (operationManagerRef.current) {
            operationManagerRef.current.acknowledgeOperation(ack);
          }
          if (ack.userId === id) {
            setLocalVersionVector(ack.baseVersionVector);
          }
        });

        // Personal queue subscriptions
        stompClient.subscribe(
          `/user/queue/document-state`,
          function (message: any) {
            const documentState = JSON.parse(message.body);
            console.log("Received personal document state:", documentState);
            setCode(documentState.content);
            setLocalVersionVector(documentState.versionVector);
            if (
              documentState.missingOperations &&
              documentState.missingOperations.length > 0
            ) {
              documentState.missingOperations.forEach((op: TextOperation) => {
                if (operationManagerRef.current) {
                  operationManagerRef.current.applyOperation(op);
                }
              });
            }
            if (operationManagerRef.current) {
              // When receiving a document state
              if (
                documentState.versionVector &&
                documentState.versionVector.versions
              ) {
                // If it has a 'versions' property, use that
                setLocalVersionVector(documentState.versionVector.versions);
                operationManagerRef.current.setVersionVector(
                  documentState.versionVector.versions
                );
              } else {
                // Otherwise use as is
                setLocalVersionVector(documentState.versionVector);
                operationManagerRef.current.setVersionVector(
                  documentState.versionVector
                );
              }
            }
          }
        );

        stompClient.subscribe(
          `/user/queue/operation-status`,
          function (message: any) {
            const response = JSON.parse(message.body);
            console.log("Operation status check response:", response);
            if (
              response.received &&
              pendingOperationsRef.current[response.operationId]
            ) {
              delete pendingOperationsRef.current[response.operationId];
            }
            if (
              !response.received &&
              pendingOperationsRef.current[response.operationId]
            ) {
              requestSync();
            }
          }
        );

        stompClient.subscribe(
          `/user/queue/sync-response`,
          function (message: any) {
            const syncResponse = JSON.parse(message.body);
            console.log("Sync response received:", syncResponse);
            if (syncResponse.operations && syncResponse.operations.length > 0) {
              syncResponse.operations.forEach((op: TextOperation) => {
                if (operationManagerRef.current) {
                  operationManagerRef.current.applyOperation(op);
                }
              });
            }
            setLocalVersionVector(syncResponse.serverVersionVector);
            if (
              operationManagerRef.current &&
              syncResponse.serverVersionVector
            ) {
              if (syncResponse.serverVersionVector.versions) {
                operationManagerRef.current.setVersionVector(
                  syncResponse.serverVersionVector.versions
                );
              } else {
                operationManagerRef.current.setVersionVector(
                  syncResponse.serverVersionVector
                );
              }
            }
            pendingOperationsRef.current = {};
          }
        );

        // Request initial document state
        requestDocumentState();

        // Assuming TextOperationManager is initialized here or elsewhere
        // Replace this with your actual initialization if it's different
        if (editorRef.current && !operationManagerRef.current) {
          operationManagerRef.current = new TextOperationManager(
            editorRef.current,
            id,
            localVersionVector,
            sendOperationRef.current // Use the ref here
          );
        }
      });

      // Track reconnections
      let reconnectAttempts = 0;
      const maxReconnectAttempts = 5;

      const handleReconnect = () => {
        if (reconnectAttempts < maxReconnectAttempts) {
          reconnectAttempts++;
          console.log(
            `Connection lost. Reconnecting (${reconnectAttempts}/${maxReconnectAttempts})...`
          );
          setTimeout(() => {
            if (socket.readyState !== SockJS.OPEN) {
              const newSocket = new SockJS("http://lcoalhost:8080/ws");
              const newStompClient = Stomp.over(newSocket);
              stompClientRef.current = newStompClient;
              newStompClient.connect(
                {},
                (frame) => {
                  console.log("Reconnected: " + frame);
                  requestSync();
                },
                (error) => {
                  console.error("Reconnection error:", error);
                  handleReconnect();
                }
              );
            }
          }, 1000 * Math.pow(2, reconnectAttempts));
        } else {
          console.error("Maximum reconnection attempts reached");
        }
      };

      const requestDocumentState = () => {
        if (stompClientRef.current?.connected) {
          stompClientRef.current.send(
            "/app/get-document-state",
            {},
            JSON.stringify({
              sessionId: sessionId,
              userId: id,
              clientVersionVector: localVersionVector,
            })
          );
        }
      };

      const requestSync = () => {
        if (stompClientRef.current?.connected) {
          stompClientRef.current.send(
            "/app/sync-operations",
            {},
            JSON.stringify({
              userId: id,
              sessionId: sessionId,
              clientVersionVector: localVersionVector,
            })
          );
        }
      };

      const pingInterval = setInterval(() => {
        if (stompClientRef.current && !stompClientRef.current.connected) {
          handleReconnect();
        }
      }, 10000);

      return () => {
        clearInterval(retryInterval);
        clearInterval(pingInterval);
        if (stompClient.connected) {
          stompClient.disconnect(() => console.log("Disconnected"));
        }
        if (socket.readyState === SockJS.OPEN) {
          socket.close();
        }
      };
    }

    return () => {
      if (stompClientRef.current?.connected) {
        stompClientRef.current.disconnect(() => console.log("Disconnected"));
        stompClientRef.current = null;
      }
    };
  }, [isSessionActive, id, sessionId]);

  const handleRunCode = async () => {
    setIsLoading(true);
    try {
      const requestBody: CodeExecutionRequest = {
        language: editorLanguage,
        version: LANGUAGE_VERSIONS[editorLanguage].version,
        files: [{ content: code }],
      };

      const response = await axios.post<CodeExecutionResponse>(
        "http://localhost:8080/api/execute",
        requestBody,
        {
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
          },
        }
      );

      const executionOutput = response.data.run.stderr
        ? `${response.data.run.stdout}\nError: ${response.data.run.stderr}`
        : response.data.run.stdout;
      // Write directly to terminal
      if (executionOutput !== "") {
        console.log(executionOutput);
        terminalRef.current?.writeToTerminal(executionOutput);
      }
    } catch (error) {
      const errorOutput = `Error: ${
        error instanceof Error ? error.message : "Unknown error occurred"
      }`;
      // Write errors directly to terminal
      terminalRef.current?.writeToTerminal(errorOutput);
    } finally {
      setIsLoading(false);
    }
  };

  let isScrolling = false; // Flag to track if a scroll action is in progress

  const handleCursorPositionChange = (lineNumber: number) => {
    const editorElement = document.querySelector(".monaco-editor");
    if (!editorElement) return;

    const lineHeight = 20; // Assume each line is 20px in height
    const cursorPositionFromTop = lineNumber * lineHeight;

    // Calculate the dynamic threshold: current scroll position + 50% of the viewport height
    const dynamicThreshold = window.scrollY + window.innerHeight * 0.52;

    // Only trigger height adjustment if the scroll action is not in progress
    if (isScrolling) return;

    // Scroll Down: If the cursor is below the threshold
    if (cursorPositionFromTop > dynamicThreshold) {
      // Mark the scroll action as in progress
      isScrolling = true;

      setEditorHeight((prevHeight) => {
        const newHeight = prevHeight + 5 * lineHeight;
        return newHeight;
      });

      window.scrollBy({
        top: 5 * lineHeight,
        behavior: "smooth",
      });

      // Reset the flag after a delay to prevent rapid triggering
      setTimeout(() => {
        isScrolling = false;
      }, 200); // Adjust delay (200ms) as needed
    }

    // Scroll Up: If the cursor is in the top 10% of the screen
    else if (
      cursorPositionFromTop <
      window.scrollY - window.innerHeight * 0.15
    ) {
      // Mark the scroll action as in progress
      isScrolling = true;

      window.scrollBy({
        top: -5 * lineHeight,
        behavior: "smooth",
      });

      // Reset the flag after a delay to prevent rapid triggering
      setTimeout(() => {
        isScrolling = false;
      }, 200); // Adjust delay (200ms) as needed
    }
  };

  const scrollToTop = () => {
    if (codeCafeRef.current) {
      window.scrollTo({
        top: 0,
        behavior: "smooth", // smooth scrolling
      });
    }
  };

  useEffect(() => {
    console.log("starredEnabled changed to:", starredEnabled);
  }, [starredEnabled]);

  // Check for session ID in URL when component mounts
  useEffect(() => {
    const url = new URL(window.location.href);
    const sessionIdFromUrl = url.searchParams.get("session");

    if (sessionIdFromUrl) {
      // If there's a session ID in the URL, we're joining an existing session
      setSessionId(sessionIdFromUrl);
      setIsJoiningSession(true);

      // Fetch session info
      axios
        .get(`http://localhost:8080/api/sessions/${sessionIdFromUrl}`)
        .then((response) => {
          setSessionCreatorName(response.data.creatorName);
        })
        .catch((error) => {
          console.error("Error fetching session info:", error);
          // Handle invalid session ID
          alert("Invalid or expired session link");
        });
    }
  }, []);

  // Modify the startSession function to create a new session
  const startSession = async () => {
    try {
      // Create a new session on the server
      const response = await axios.post(
        "http://localhost:8080/api/sessions/create",
        {
          creatorName: name || displayName || "Anonymous",
        }
      );

      const newSessionId = response.data.sessionId;
      setSessionId(newSessionId);
      setIsSessionCreator(true); // Mark this user as the session creator

      // Update URL with session ID without reloading the page
      const url = new URL(window.location.href);
      url.searchParams.set("session", newSessionId);
      window.history.pushState({}, "", url.toString());

      // Now activate the WebSocket connection
      setIsSessionActive(true);

      // Force a cursor update after a short delay to ensure WebSocket is connected
      setTimeout(() => {
        debouncedSendCursor({
          cursorPosition: { lineNumber: 1, column: 1 },
          selection: null,
        });
      }, 500);
    } catch (error) {
      console.error("Error creating session:", error);
      alert("Failed to create session. Please try again.");
    }
  };

  // Add a function to join an existing session
  const joinSession = () => {
    if (!sessionId) return;

    setIsSessionActive(true);

    // Force a cursor update after a short delay to ensure WebSocket is connected
    setTimeout(() => {
      debouncedSendCursor({
        cursorPosition: { lineNumber: 1, column: 1 },
        selection: null,
      });
    }, 500);
  };

  const handleSimulateTyping = () => {
    if (editorRef.current && operationManagerRef.current) {
      simulateRapidTyping(
        editorRef.current,
        operationManagerRef.current,
        "Debugging CodeCafe Debugging CodeCafe Debugging CodeCafe Debugging CodeCafe Debugging CodeCafe Debugging CodeCafe Debugging CodeCafe Debugging CodeCafe Debugging CodeCafe Debugging CodeCafe Debugging CodeCafe Debugging CodeCafe Debugging CodeCafe Debugging CodeCafe Debugging CodeCafe Debugging CodeCafe Debugging CodeCafe Debugging CodeCafe Debugging CodeCafe Debugging CodeCafe Debugging CodeCafe ",
        50 // Adjust typing speed as needed
      );
    }
  };

  return (
    <Theme appearance="dark" accentColor="bronze" radius="large">
      <div className="bg-gradient-to-b from-stone-800 to-stone-600 fixed top-0 left-0 right-0 h-screen z-0" />
      {isEditorLoading && (
        <div className="absolute inset-0 flex justify-center items-center z-50">
          <ReactLoading
            type="spin"
            color="#57534e"
            height={100}
            width={80}
            delay={0}
          />
        </div>
      )}
      <SettingsWindow
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        currentLanguage={editorLanguage}
        onLanguageChange={(editorLanguage) => {
          // Cast is needed since TypeScript doesn't know that newLanguage is a valid key
          setEditorLanguage(editorLanguage as keyof typeof LANGUAGE_VERSIONS);
        }}
        availableLanguages={Object.entries(LANGUAGE_VERSIONS).map(
          ([key, value]) => ({
            value: key,
            label: value.name,
          })
        )}
        currentTheme={theme}
        onThemeChange={setTheme}
        currentFontSize={fontSize}
        onFontSizeChange={setFontSize}
        currentWordWrap={wordWrap}
        onWordWrapChange={setWordWrap}
        currentShowLineNumbers={showLineNumbers}
        onShowLineNumbersChange={setShowLineNumbers}
      />
      <div className={`${isEditorLoading ? "hidden" : ""}`}>
        <SlideMenu />
        <div
          className="items-center justify-center p-4 relative flex flex-col h-max"
          ref={codeCafeRef}
        >
          <div className="fixed top-0 left-0 w-full h-12 bg-gradient-to-b from-stone-800 via-stone-800 to-transparent py-2 px-4 z-40 outline-none flex flex-row" />
          <div className="fixed top-0 left-0 w-full py-2 px-4 z-50 outline-none flex flex-row mt-[1px]">
            <div
              className="relative h-8 w-auto cursor-pointer -ml-2"
              onClick={scrollToTop}
            >
              <img
                src="image-1.png"
                className="top-0 left-0 p-1 h-[35px] transition-opacity duration-300 ease-in-out opacity-100 hover:opacity-0 -mt-[1px] ml-[1px]"
              />
              <img
                src="image-light.png"
                className="absolute top-0 left-0 p-1 h-[35px] transition-opacity duration-300 ease-in-out opacity-0 hover:opacity-100 -mt-[1px] ml-[1px]"
              />
              {/* <span className="text-stone-500 text-lg font-georgia">
                {" "}
                CodeCafe{" "}
              </span> */}
            </div>

            <button
              className="flex items-center justify-center p-2 rounded-md transition-all duration-200 bg-transparent hover:bg-neutral-900 active:bg-stone-950 active:scale-95 text-stone-500 hover:text-stone-400"
              onClick={() => {
                handleRunCode();
              }}
            >
              <VscRunAll className="text-lg" />
            </button>
            {/* <button className="flex ml-auto flex-row gap-1 items-center p-2 rounded-md transition-all duration-200 bg-transparent hover:bg-neutral-900 active:bg-neutral-950 active:scale-95 cursor-pointer text-lg text-stone-500 hover:text-stone-400">
              <GoPersonAdd />
              <span className="text-xs">Share</span>
            </button> */}
            <ShareProfile
              onNameChange={(newName) => {
                setName(newName);
                setDisplayName(newName);
              }}
              onColorChange={(newColor) => {
                setColor(newColor);
              }}
              users={users}
              onStartSession={startSession}
              isSessionActive={isSessionActive}
              sessionId={sessionId}
              isJoiningSession={isJoiningSession}
              sessionCreatorName={sessionCreatorName}
              onJoinSession={joinSession}
              isSessionCreator={isSessionCreator}
              currentUserName={displayName || name} // Pass current user name
              currentUserColor={color} // Pass current user color
            />
            <button
              onClick={() => {
                setStarredEnabled(!starredEnabled);
                console.log(users);
              }}
              className="flex items-center justify-center p-2 rounded-md transition-all duration-200 bg-transparent hover:bg-neutral-900 active:bg-stone-950 active:scale-95 text-stone-500 hover:text-stone-400 ml-1"
            >
              {starredEnabled ? <IoStar /> : <IoStarOutline />}
            </button>
            <button
              className="flex items-center justify-center p-2 rounded-md transition-all duration-200 bg-transparent hover:bg-neutral-900 active:bg-stone-950 active:scale-95 text-stone-500 hover:text-stone-400 ml-1 -mr-2"
              onClick={() => setIsSettingsOpen(true)}
            >
              <VscSettings />
            </button>
            <button
              className="flex items-center justify-center p-2 rounded-md transition-all duration-200 bg-transparent hover:bg-neutral-900 active:bg-stone-950 active:scale-95 text-stone-500 hover:text-stone-400 ml-1"
              onClick={handleSimulateTyping}
            >
              Simulate Typing
            </button>
          </div>
          <div className="relative flex flex-col items-center w-full md:w-[950px] sm:w-[85%]">
            {/* Code Area - Added z-index to ensure hints are visible */}
            <div
              className=" absolute bg-neutral-900/70 rounded-t-lg border border-neutral-800/50 mt-32 w-[120%]"
              style={{
                height: `${editorHeight}px`,
                willChange: "transform",
              }}
            >
              <div className="py-6 px-4 h-full text-neutral-300">
                <CodeEditor
                  onCodeChange={handleCodeChange}
                  users={users}
                  onCursorPositionChange={handleCursorPositionChange}
                  code={code}
                  sendCursorData={sendCursorData}
                  onLoadingChange={setIsEditorLoading}
                  language={editorLanguage}
                  theme={theme}
                  fontSize={fontSize}
                  wordWrap={wordWrap}
                  showLineNumbers={showLineNumbers}
                  onEditorDidMount={handleEditorDidMount}
                />
              </div>
            </div>

            <div
              style={{
                position: "fixed",
                top: `${editorHeight}px`, // aligns right after the editor
                left: 0,
                right: 0,
                height: "200px",
                background: "rgba(55, 65, 81, 0.7)", // same background
                pointerEvents: "none",
                userSelect: "none",
                zIndex: -1, // behind the scroll container
              }}
            />

            <Terminal ref={terminalRef} />
          </div>
        </div>
      </div>
    </Theme>
  );
};

export default App;
