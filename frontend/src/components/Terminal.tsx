import {
  useEffect,
  useRef,
  forwardRef,
  useImperativeHandle,
  useState,
} from "react";
import { Terminal } from "xterm";
import "xterm/css/xterm.css";
import { FitAddon } from "xterm-addon-fit";
import { Card } from "@radix-ui/themes";
import { ResizableBox, ResizeHandle } from "react-resizable";
import "react-resizable/css/styles.css";

const TerminalComponent = forwardRef((_, ref) => {
  const terminalRef = useRef<HTMLDivElement>(null);
  const terminalInstance = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const currentLineRef = useRef<string>("");

  // ResizableBox related states
  const [height, setHeight] = useState(window.innerHeight * 0.25);
  const [width, setWidth] = useState(window.innerWidth * 0.75);

  // Calculate screen sixteenth for constraints
  const screenSixteenth = {
    width: window.innerWidth * (1 / 16),
    height: window.innerHeight * (1 / 16),
  };

  useEffect(() => {
    const term = new Terminal({
      cursorBlink: true,
      fontSize: 14,
      fontFamily: "monospace",
      theme: {
        background: "rgba(0,0,0,0)",
        foreground: "#ffffff",
      },
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);

    if (terminalRef.current) {
      term.open(terminalRef.current);

      // Create a ResizeObserver to handle container resize
      const resizeObserver = new ResizeObserver(() => {
        requestAnimationFrame(() => {
          try {
            fitAddon.fit();
          } catch (error) {
            console.error("Terminal resize error:", error);
          }
        });
      });

      // Observe the parent container
      if (terminalRef.current.parentElement) {
        resizeObserver.observe(terminalRef.current.parentElement);
      }

      // Initial fit
      fitAddon.fit();

      // Store references
      terminalInstance.current = term;
      fitAddonRef.current = fitAddon;
      resizeObserverRef.current = resizeObserver;

      term.write("Welcome to CodeCafe!\r\n$ ");

      // Handle user input
      term.onData((data) => {
        // Handle Enter key
        if (data === "\r") {
          const command = currentLineRef.current;
          currentLineRef.current = "";

          term.write("\r\n");

          // Process command
          if (command === "clear") {
            term.clear();
          } else if (command === "help") {
            term.write("Available commands: clear, help, echo, date\r\n");
          } else if (command.startsWith("echo ")) {
            term.write(command.substring(5) + "\r\n");
          } else if (command === "date") {
            term.write(new Date().toLocaleString() + "\r\n");
          } else if (command === "codecafe") {
            term.write("\r\n");
            term.write(
              "   ______            __       ______        ____    \r\n"
            );
            term.write(
              "  / ____/____   ____/ /___   / ____/____ _ / __/___ \r\n"
            );
            term.write(
              " / /    / __ \\ / __  // _ \\ / /    / __ `// /_ / _ \\\r\n"
            );
            term.write(
              "/ /___ / /_/ // /_/ //  __// /___ / /_/ // __//  __/\r\n"
            );
            term.write(
              "\\____/ \\____/ \\__,_/ \\___/ \\____/ \\__,_//_/   \\___/\r\n"
            );
            term.write("\r\n");
          } else if (command.length > 0) {
            term.write(`Command not found: ${command}\r\n`);
            term.write("Type 'help' to see available commands.\r\n");
          }

          term.write("$ ");
        }
        // Handle backspace
        else if (data === "\x7f") {
          if (currentLineRef.current.length > 0) {
            currentLineRef.current = currentLineRef.current.substring(
              0,
              currentLineRef.current.length - 1
            );
            term.write("\b \b");
          }
        }
        // Handle normal input (printable characters)
        else if (data >= " " && data <= "~") {
          currentLineRef.current += data;
          term.write(data);
        }
      });
    }

    // Handle window resize
    const handleWindowResize = () => {
      setHeight(window.innerHeight * 0.25);
      setWidth(window.innerWidth * 0.75);

      // Refit terminal on window resize
      if (fitAddonRef.current) {
        fitAddonRef.current.fit();
      }
    };

    window.addEventListener("resize", handleWindowResize);

    // Cleanup function
    return () => {
      window.removeEventListener("resize", handleWindowResize);
      if (terminalInstance.current) {
        terminalInstance.current.dispose();
      }
      if (resizeObserverRef.current) {
        resizeObserverRef.current.disconnect();
      }
    };
  }, []);

  useImperativeHandle(ref, () => ({
    writeToTerminal: (output: string) => {
      if (terminalInstance.current) {
        const term = terminalInstance.current;
        term.write("\x1b[2K\r"); // Clear the current line

        const lines = output.split("\n");
        lines.forEach((line, index) => {
          if (index > 0) {
            term.write("\r\n");
          }
          term.write(line);
        });

        if (!output.endsWith("\n")) {
          term.write("\r\n");
        }
        term.write("$ ");
      }
    },

    clear: () => {
      if (terminalInstance.current) {
        terminalInstance.current.clear();
        terminalInstance.current.write("$ ");
      }
    },
  }));

  return (
    <ResizableBox
      className="overflow-hidden overscroll-none"
      width={width}
      height={height}
      minConstraints={[
        Math.max(300, window.innerWidth * 0.7 - screenSixteenth.width),
        Math.max(100, window.innerHeight * 0.1 - screenSixteenth.height),
      ]}
      maxConstraints={[
        Math.min(
          window.innerWidth,
          window.innerWidth * 0.75 + screenSixteenth.width
        ),
        Math.min(
          window.innerHeight,
          window.innerHeight * 0.35 + screenSixteenth.height
        ),
      ]}
      onResize={(_, { size }) => {
        setWidth(size.width);
        setHeight(size.height);
        // Trigger terminal fit after resize
        setTimeout(() => {
          if (fitAddonRef.current) {
            fitAddonRef.current.fit();
          }
        }, 0);
      }}
      resizeHandles={["w", "nw", "n"]}
      handle={(handleAxis, handleRef) => {
        const baseStyle = {
          background: "transparent",
          transform: "translate(-50%, -50%)",
        };

        // Custom styles for each handle
        const styles: Record<ResizeHandle, React.CSSProperties | undefined> = {
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
            ref={handleRef}
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
      <Card className="bg-neutral-900/70 backdrop-blur-md rounded-tl-lg border border-neutral-800/50 shadow-xl overflow-auto overscroll-none">
        <div
          className="p
          -4 font-mono text-green-400/80"
          style={{ height, width }}
        >
          <div
            ref={terminalRef}
            style={{
              width: "100%",
              height: "100%",
              backgroundColor: "rgba(0,0,0,0)",
            }}
            className="overflow-hidden"
          />
        </div>
      </Card>
    </ResizableBox>
  );
});

TerminalComponent.displayName = "TerminalComponent";

export default TerminalComponent;
