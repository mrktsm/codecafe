import { ConnectionStatus, StatusBarProps } from "../types/props";

const StatusBar = ({
  connectionStatus,
  language = "plaintext",
  line = 1, // Default line
  column = 1, // Default column
}: StatusBarProps) => {
  // function to determine status indicator style
  const getStatusIndicator = (status: ConnectionStatus) => {
    switch (status) {
      case "connected":
        return null;
      case "disconnected":
        return (
          <span
            className="w-2 h-2 bg-red-500 rounded-full inline-block mr-1.5"
            title="Disconnected"
          ></span>
        );
      case "connecting":
        return (
          <span
            className="w-2 h-2 bg-yellow-500 rounded-full inline-block mr-1.5 animate-pulse"
            title="Connecting..."
          ></span>
        );
      default:
        return null;
    }
  };

  return (
    <div className="bg-stone-800 bg-opacity-80 text-stone-500 flex justify-between items-stretch h-6 text-xs border-t border-stone-600 flex-shrink-0">
      {/* Left Group - Remove padding/spacing */}
      <div className="flex items-stretch">
        {/* Connection Status Indicator - Apply item styling */}
        {connectionStatus && (
          <div className="flex items-center px-3 cursor-default select-none hover:bg-stone-700 hover:text-stone-200">
            {getStatusIndicator(connectionStatus)}
            {connectionStatus.charAt(0).toUpperCase() +
              connectionStatus.slice(1)}
          </div>
        )}
        {/* Language - Apply item styling */}
        <div className="flex items-center px-3 cursor-default select-none hover:bg-stone-700 hover:text-stone-200">
          {language}
        </div>
        {/* Encoding - Apply item styling */}
        <div className="flex items-center px-3 cursor-default select-none hover:bg-stone-700 hover:text-stone-200">
          UTF-8
        </div>
      </div>
      {/* Right Group - Remove padding/spacing */}
      <div className="flex items-stretch">
        {/* Line/Col - Apply item styling */}
        <div className="flex items-center px-3 cursor-default select-none hover:bg-stone-700 hover:text-stone-200">
          Ln {line}, Col {column}
        </div>
        {/* Spaces - Apply item styling */}
        <div className="flex items-center px-3 cursor-default select-none hover:bg-stone-700 hover:text-stone-200">
          Spaces: 2 {/* TODO: Make spaces dynamic? */}
        </div>
      </div>
    </div>
  );
};

export default StatusBar;
