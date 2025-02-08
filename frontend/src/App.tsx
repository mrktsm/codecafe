import { useEffect, useRef, useState } from "react";
import axios from "axios";
import CodeEditor from "./components/CodeEditor";
import Terminal from "./components/Terminal";
import { Card, Theme } from "@radix-ui/themes";
import "react-resizable/css/styles.css";
import { ResizableBox, ResizeHandle } from "react-resizable";
import SockJS from "sockjs-client";
import Stomp from "stompjs";
import { VscRunAll } from "react-icons/vsc";
import { GoPersonAdd } from "react-icons/go";
import { VscSettings } from "react-icons/vsc";
import { IoStarOutline } from "react-icons/io5";
import SlideMenu from "./components/SlideMenu";

interface CodeExecutionRequest {
  language: string;
  version: string;
  files: { content: string }[];
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

interface CodeExecutionResponse {
  language: string;
  version: string;
  run: {
    stdout: string;
    stderr: string;
    code: number;
    signal: string | null;
    output: string;
  };
}

interface User {
  id: string;
  name: string;
  color: string;
  cursorPosition: {
    lineNumber: number;
    column: number;
  };
  selection: {
    startLineNumber: number;
    startColumn: number;
    endLineNumber: number;
    endColumn: number;
  };
}

// Utility function to generate a random color in hex format
const generateRandomColor = (): string => {
  const letters = "0123456789ABCDEF";
  let color = "#";
  for (let i = 0; i < 6; i++) {
    color += letters[Math.floor(Math.random() * 16)];
  }
  return color;
};

const App: React.FC = () => {
  const [code, setCode] = useState<string>("// Hello there");
  const [editorHeight, setEditorHeight] = useState(window.innerHeight);
  const [height, setHeight] = useState(window.innerHeight * 0.25);
  const [width, setWidth] = useState(window.innerWidth * 0.75);
  const [users, setUsers] = useState<User[]>([]);
  const [id, setId] = useState<string>(Date.now().toString());
  const [name, setName] = useState<string>(Date.now().toString());
  // Use a random color for this frontend instance
  const [color] = useState<string>(generateRandomColor());
  const stompClientRef = useRef<Stomp.Client | null>(null);

  const screenSixteenth = {
    width: window.innerWidth * (1 / 16),
    height: window.innerHeight * (1 / 16),
  };

  // const socket = new SockJS("http://localhost:8080/ws");
  // const stompClient = Stomp.over(socket);

  const [isLoading, setIsLoading] = useState<boolean>(false);
  const terminalRef = useRef<{ writeToTerminal: (text: string) => void }>(null);

  useEffect(() => console.log("User state: ", users), [users]);

  const handleCodeChange = (newCode: string) => {
    setCode(newCode);

    const message = {
      code: newCode,
      user: null,
    };

    if (stompClientRef.current && stompClientRef.current.connected)
      stompClientRef.current?.send("/app/message", {}, JSON.stringify(message));
  };

  const sendCursorData = (cursorData: CursorData) => {
    const cursorMessage = {
      user: {
        id: id,
        name: name,
        color: color, // use the randomly generated color for this instance
        cursor: {
          cursorPosition: cursorData.cursorPosition,
          selection: cursorData.selection,
        },
      },
    };
    if (stompClientRef.current && stompClientRef.current.connected) {
      stompClientRef.current.send("/app/cursor", {}, JSON.stringify(cursorMessage));
    }
  };

  useEffect(() => {
    const handleResize = () => {
      if (editorHeight < window.innerHeight) {
        setEditorHeight(window.innerHeight);
      }
      setHeight(window.innerHeight * 0.25);
      setWidth(window.innerWidth * 0.75);
    };

    window.addEventListener("resize", handleResize);
    return () => {
      window.removeEventListener("resize", handleResize);
    };
  }, []);

  useEffect(() => {
    const socket = new SockJS("http://localhost:8080/ws");
    const stompClient = Stomp.over(socket);

    stompClient.connect({}, function (frame: any) {
      console.log("Connected: " + frame);

      stompClient.subscribe("/topic/messages", function (message: any) {
        const messageData = JSON.parse(message.body);
        console.log("Received: ", messageData);

        if (messageData.code !== null) {
          setCode(messageData.code);
        }

        if (messageData.user) {
          setUsers((prevUsers) => {
            const updatedUser: User = {
              id: messageData.user.id, // use id sent from the sender
              name: messageData.user.name, // use name from the sender
              color: messageData.user.color,
              cursorPosition: messageData.user.cursor.cursorPosition,
              selection: messageData.user.cursor.selection || undefined,
            };

            // Update the user if it already exists
            const existingUser = prevUsers.find((u) => u.id === updatedUser.id);
            if (existingUser) {
              return prevUsers.map((user) =>
                user.id === updatedUser.id ? updatedUser : user
              );
            }

            // Otherwise, add as a new user
            return [...prevUsers, updatedUser];
          });
        }
      });

      // New subscription for cursor updates:
      stompClient.subscribe("/topic/cursors", function (message: any) {
        const messageData = JSON.parse(message.body);
        console.log("Received cursor update: ", messageData);
        if (messageData.user) {
          setUsers((prevUsers) => {
            const updatedUser: User = {
              id: messageData.user.id,
              name: messageData.user.name,
              color: messageData.user.color,
              cursorPosition: messageData.user.cursor.cursorPosition,
              selection: messageData.user.cursor.selection || undefined,
            };

            const existingUser = prevUsers.find((u) => u.id === updatedUser.id);
            if (existingUser) {
              return prevUsers.map((user) =>
                user.id === updatedUser.id ? updatedUser : user
              );
            }
            return [...prevUsers, updatedUser];
          });
        }
      });
    });

    stompClientRef.current = stompClient;

    return () => {
      if (stompClient.connected) {
        stompClient.disconnect(() => console.log("Disconnected"));
      }
      if (socket.readyState === SockJS.OPEN) {
        socket.close();
      }
    };
  }, []);

  const handleRunCode = async () => {
    setIsLoading(true);
    try {
      const requestBody: CodeExecutionRequest = {
        language: "javascript",
        version: "18.15.0",
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
      console.log(executionOutput);
      terminalRef.current?.writeToTerminal(executionOutput);
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

  return (
    <Theme appearance="dark" accentColor="bronze" radius="large">
      <div className="bg-gradient-to-b from-stone-800 to-stone-600 fixed top-0 left-0 right-0 h-screen z-0" />
      <SlideMenu />
      <div className="items-center justify-center p-4 relative flex flex-col h-max">
        <div className="fixed top-0 left-0 w-full h-12 bg-gradient-to-b from-stone-800 via-stone-800 to-transparent py-2 px-4 z-40 outline-none flex flex-row" />
        <div className="fixed top-0 left-0 w-full py-2 px-4 z-50 outline-none flex flex-row">
          <div className="relative h-8 w-auto cursor-pointer -ml-2">
            <img
              src="codecafe_logo.png"
              className="top-0 left-0 p-2 h-8 mt-[1.5px] transition-opacity duration-300 ease-in-out opacity-100 hover:opacity-0"
            />
            <img
              src="codecafe_logo_light.png"
              className="absolute top-0 left-0 p-2 h-8 mt-[1.5px] transition-opacity duration-300 ease-in-out opacity-0 hover:opacity-100"
            />
          </div>

          <button
            className="flex ml-2 items-center justify-center p-2 rounded-md transition-all duration-200 bg-transparent hover:bg-neutral-900 active:bg-stone-950 active:scale-95 text-stone-500 hover:text-stone-400"
            onClick={() => {
              handleRunCode();
            }}
          >
            <VscRunAll className="text-lg" />
          </button>
          <button className="flex ml-auto flex-row gap-1 items-center p-2 rounded-md transition-all duration-200 bg-transparent hover:bg-neutral-900 active:bg-neutral-950 active:scale-95 cursor-pointer text-lg text-stone-500 hover:text-stone-400">
            <GoPersonAdd />
            <span className="text-xs">Share</span>
          </button>
          <button className="flex items-center justify-center p-2 rounded-md transition-all duration-200 bg-transparent hover:bg-neutral-900 active:bg-stone-950 active:scale-95 text-stone-500 hover:text-stone-400 ml-1">
            <IoStarOutline />
          </button>
          <button className="flex items-center justify-center p-2 rounded-md transition-all duration-200 bg-transparent hover:bg-neutral-900 active:bg-stone-950 active:scale-95 text-stone-500 hover:text-stone-400 ml-1 -mr-2">
            <VscSettings />
          </button>
        </div>
        <div className="relative flex flex-col items-center w-full max-w-4xl">
          {/* Code Area - Added z-index to ensure hints are visible */}
          <div
            className=" bg-neutral-900/70  rounded-t-xl border border-neutral-800/50 mt-32 w-[120%]"
            style={{ height: `${editorHeight}px`, willChange: "transform" }}
            // variant="ghost"
          >
            <div className="p-6 h-full text-neutral-300">
              <CodeEditor
                onCodeChange={handleCodeChange}
                users={users}
                onCursorPositionChange={handleCursorPositionChange}
                code={code}
                sendCursorData={sendCursorData}
              />
            </div>
          </div>

          {/* Terminal */}
          {/* <Card className="bg-neutral-900/90 backdrop-blur-md rounded-t-xl border border-neutral-800/50 shadow-xl fixed bottom-0 left-0 ml-[25%] w-[300%]">
              <div className="p-4 h-64 font-mono text-green-400/80 overflow-auto">
                <Terminal />
              </div>
            </Card> */}

          <ResizableBox
            width={width}
            height={height}
            minConstraints={[
              Math.max(300, window.innerWidth * 0.75 - screenSixteenth.width),
              Math.max(100, window.innerHeight * 0.1 - screenSixteenth.height),
            ]}
            maxConstraints={[
              Math.min(
                window.innerWidth,
                window.innerWidth * 0.75 + screenSixteenth.width
              ),
              Math.min(
                window.innerHeight,
                window.innerHeight * 0.25 + screenSixteenth.height
              ),
            ]}
            onResize={(e, { size }) => {
              setWidth(size.width);
              setHeight(size.height);
            }}
            resizeHandles={["w", "nw", "n"]}
            handle={(handleAxis, ref) => {
              const baseStyle = {
                // position: "absolute",
                background: "transparent",
                // border: "2px solid rgba(200, 200, 200, 0.3)",
                transform: "translate(-50%, -50%)",
              };

              // Custom styles for each handle
              const styles: Record<
                ResizeHandle,
                React.CSSProperties | undefined
              > = {
                nw: {
                  ...baseStyle,
                  width: "5px",
                  height: "5px",
                  padding: "5px",
                },
                n: {
                  ...baseStyle,
                  width: `${width}px`,
                  height: "5px",
                  padding: "5px",
                  transform: "translate(-50%, -50%) translateX(15px)",
                },
                w: {
                  ...baseStyle,
                  width: "5px",
                  height: `${height}px`,
                  padding: "5px",
                  transform: "translate(-50%, -50%) translateY(15px)",
                },
                s: undefined,
                e: undefined,
                sw: undefined,
                se: undefined,
                ne: undefined,
              };

              return (
                <div
                  ref={ref}
                  className={`react-resizable-handle react-resizable-handle-${handleAxis}`}
                  style={styles[handleAxis]}
                />
              );
            }}
            style={{
              position: "fixed",
              bottom: 0,
              left: `calc(100vw - ${width}px)`,
              zIndex: 10,
            }}
          >
            <Card className="bg-neutral-900/70 backdrop-blur-md rounded-tl-xl border border-neutral-800/50 shadow-xl">
              <div
                className="p-4 font-mono text-green-400/80 overflow-auto"
                style={{ height, width }}
              >
                <Terminal ref={terminalRef} />
              </div>
            </Card>
          </ResizableBox>
        </div>
      </div>
    </Theme>
  );
};

export default App;
