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

// Define ANSI color codes for styling terminal text
const ANSI_COLORS = {
  RESET: "\x1b[0m",
  PROMPT_COLOR: "\x1b[38;5;246m", // Light gray for prompt ($)
  INPUT_COLOR: "\x1b[38;5;246m", // Light gray for user input text (same as prompt)
  OUTPUT_COLOR: "\x1b[38;5;252m", // Slightly whiter for command output
};

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
      allowTransparency: true,
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

      term.write("Welcome to CodeCafe!\r\n");
      writePrompt(term);

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
            term.write(
              `${ANSI_COLORS.OUTPUT_COLOR}Available commands: clear, help, echo, date\r\n`
            );
          } else if (command.startsWith("echo ")) {
            term.write(
              `${ANSI_COLORS.OUTPUT_COLOR}${command.substring(5)}\r\n`
            );
          } else if (command === "date") {
            term.write(
              `${ANSI_COLORS.OUTPUT_COLOR}${new Date().toLocaleString()}\r\n`
            );
          } else if (command === "codecafe") {
            term.write("\r\n");
            term.write(
              `${ANSI_COLORS.OUTPUT_COLOR}   ______            __       ______        ____    \r\n`
            );
            term.write(
              `${ANSI_COLORS.OUTPUT_COLOR}  / ____/____   ____/ /___   / ____/____ _ / __/___ \r\n`
            );
            term.write(
              `${ANSI_COLORS.OUTPUT_COLOR} / /    / __ \\ / __  // _ \\ / /    / __ \`// /_ / _ \\\r\n`
            );
            term.write(
              `${ANSI_COLORS.OUTPUT_COLOR}/ /___ / /_/ // /_/ //  __// /___ / /_/ // __//  __/\r\n`
            );
            term.write(
              `${ANSI_COLORS.OUTPUT_COLOR}\\____/ \\____/ \\__,_/ \\___/ \\____/ \\__,_//_/   \\___/\r\n`
            );
            term.write("\r\n");
          } else if (command.length > 0) {
            term.write(
              `${ANSI_COLORS.OUTPUT_COLOR}Command not found: ${command}\r\n`
            );
            term.write(
              `${ANSI_COLORS.OUTPUT_COLOR}Type 'help' to see available commands.\r\n`
            );
          }

          writePrompt(term);
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
          // Use the input color for typed text
          term.write(`${ANSI_COLORS.INPUT_COLOR}${data}${ANSI_COLORS.RESET}`);
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

  // Helper function to write the prompt with the correct color
  const writePrompt = (term: Terminal) => {
    term.write(`${ANSI_COLORS.PROMPT_COLOR}$ ${ANSI_COLORS.RESET}`);
  };

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
          term.write(`${ANSI_COLORS.OUTPUT_COLOR}${line}${ANSI_COLORS.RESET}`);
        });

        if (!output.endsWith("\n")) {
          term.write("\r\n");
        }
        writePrompt(term);
      }
    },

    clear: () => {
      if (terminalInstance.current) {
        terminalInstance.current.clear();
        writePrompt(terminalInstance.current);
      }
    },
  }));

  return (
    <div
      ref={terminalRef}
      style={{
        width: "100%",
        height: "100%",
        backgroundColor: "rgba(0,0,0,0)",
      }}
      className="overflow-hidden"
    />
  );
});

TerminalComponent.displayName = "TerminalComponent";

export default TerminalComponent;
