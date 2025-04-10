import { useState, useEffect } from "react";
import { Card } from "@radix-ui/themes";
import { motion, AnimatePresence } from "framer-motion";
import { VscCheck } from "react-icons/vsc";
import ToggleSwitch from "./ui/ToggleSwitch";
import { SettingsWindowProps } from "../types/props";
import { THEMES, ThemeKey } from "../constants/themes";
import { FONT_SIZES } from "../constants/fontSizes";
import Select from "./ui/Select";

const SettingsWindow = ({
  isOpen,
  onClose,
  currentLanguage,
  onLanguageChange,
  availableLanguages,
  currentTheme,
  onThemeChange,
  currentFontSize,
  onFontSizeChange,
  currentWordWrap,
  onWordWrapChange,
  currentShowLineNumbers,
  onShowLineNumbersChange,
}: SettingsWindowProps) => {
  // Settings state
  const [theme, setTheme] = useState<ThemeKey>(currentTheme);
  const [fontSize, setFontSize] = useState(currentFontSize);
  // Use the passed currentLanguage for initial state
  const [language, setLanguage] = useState(currentLanguage);
  // const [autoSave, setAutoSave] = useState(true);
  const [wordWrap, setWordWrap] = useState(currentWordWrap);
  const [showLineNumbers, setShowLineNumbers] = useState(
    currentShowLineNumbers
  );

  // Update local state when prop changes
  useEffect(() => {
    setLanguage(currentLanguage);
  }, [currentTheme, isOpen]);

  useEffect(() => {
    setTheme(currentTheme);
  }, [currentTheme, isOpen]);

  useEffect(() => {
    setFontSize(currentFontSize);
  }, [currentFontSize, isOpen]);

  useEffect(() => {
    setWordWrap(currentWordWrap);
  }, [currentWordWrap, isOpen]);

  useEffect(() => {
    setShowLineNumbers(currentShowLineNumbers);
  }, [currentShowLineNumbers, isOpen]);

  // Prevent body scrolling when modal is open
  useEffect(() => {
    if (isOpen) {
      // Save current scroll position
      const scrollY = window.scrollY;

      // Add styles to prevent scrolling on the body
      document.body.style.position = "fixed";
      document.body.style.top = `-${scrollY}px`;
      document.body.style.width = "100%";

      return () => {
        // Restore scrolling when component unmounts or modal closes
        document.body.style.position = "";
        document.body.style.top = "";
        document.body.style.width = "";

        // Restore scroll position
        window.scrollTo(0, scrollY);
      };
    }
  }, [isOpen]);

  const handleClose = () => {
    onClose();
  };

  const handleSaveSettings = () => {
    // Save settings logic here
    console.log("Saving settings:", {
      theme,
      fontSize,
      language,
      // autoSave,
      wordWrap,
      showLineNumbers,
    });

    // Call the parent's onLanguageChange if language was changed
    if (language !== currentLanguage) {
      onLanguageChange(language);
    }
    if (theme !== currentTheme) {
      onThemeChange(theme as ThemeKey);
    }

    if (fontSize !== currentFontSize) {
      onFontSizeChange(fontSize);
    }

    if (wordWrap !== currentWordWrap) {
      onWordWrapChange(wordWrap);
    }

    if (showLineNumbers !== currentShowLineNumbers) {
      onShowLineNumbersChange(showLineNumbers);
    }

    onClose();
  };

  // Create theme options from the THEMES object
  const themeOptions = Object.entries(THEMES).map(([key, themeData]) => ({
    value: key,
    label: themeData.label,
  }));

  return (
    <AnimatePresence>
      {isOpen && (
        <div
          className="fixed inset-0 bg-black/40 backdrop-blur-[5px] flex items-center justify-center z-[100]"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              handleClose();
            }
          }}
        >
          <motion.div
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.95, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="w-full max-w-[40rem] mx-4 max-h-[90vh]"
          >
            <Card className="bg-neutral-900/80 backdrop-blur-lg border border-stone-800/50 shadow-2xl rounded-xl overflow-hidden">
              <div className="px-8 py-6 overflow-y-auto max-h-[80vh]">
                {/* Title Section */}
                <div className="mb-8">
                  <h2 className="text-2xl font-semibold text-stone-200">
                    Settings
                  </h2>
                  <p className="text-stone-400 text-sm mt-1">
                    Customize your editor experience
                  </p>
                </div>

                {/* Settings Section */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-x-10">
                  {/* Left Column */}
                  <div>
                    {/* Appearance Section */}
                    <div className="mb-6">
                      <h3 className="text-md font-medium text-stone-300 border-b border-stone-700/50 pb-2 mb-4">
                        Appearance
                      </h3>

                      <Select
                        value={theme}
                        onChange={(value: string) =>
                          setTheme(value as ThemeKey)
                        }
                        options={themeOptions}
                        label="Theme"
                      />

                      <Select
                        value={fontSize}
                        onChange={setFontSize}
                        options={FONT_SIZES}
                        label="Font Size"
                      />
                    </div>

                    {/* Language Section */}
                    <div className="mb-6">
                      <h3 className="text-md font-medium text-stone-300 border-b border-stone-700/50 pb-2 mb-4">
                        Language
                      </h3>

                      <Select
                        value={language}
                        onChange={setLanguage}
                        options={availableLanguages}
                        label="Editor Language"
                      />
                    </div>
                  </div>

                  {/* Right Column */}
                  <div>
                    {/* Editor Section */}
                    <div className="mb-6">
                      <h3 className="text-md font-medium text-stone-300 border-b border-stone-700/50 pb-2 mb-4">
                        Editor
                      </h3>

                      <ToggleSwitch
                        isOn={wordWrap}
                        handleToggle={setWordWrap}
                        label="Word Wrap"
                      />

                      <ToggleSwitch
                        isOn={showLineNumbers}
                        handleToggle={setShowLineNumbers}
                        label="Show Line Numbers"
                      />

                      {/* <ToggleSwitch
                        checked={autoSave}
                        onChange={setAutoSave}
                        label="Auto Save"
                      /> */}
                    </div>
                  </div>
                </div>

                {/* Footer Buttons */}
                <div className="flex gap-3 mt-8">
                  <button
                    className="flex-1 px-4 py-2 text-sm font-medium rounded-md border border-stone-700/50 text-stone-300 hover:bg-stone-800/50 hover:text-stone-200 transition-colors"
                    onClick={handleClose}
                  >
                    Cancel
                  </button>
                  <button
                    className="flex-1 px-4 py-2 text-sm font-medium rounded-md bg-stone-200 hover:bg-stone-300 text-stone-900 transition-colors flex items-center justify-center gap-1.5"
                    onClick={handleSaveSettings}
                  >
                    <VscCheck className="text-lg" />
                    <span>Save Changes</span>
                  </button>
                </div>
              </div>
            </Card>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
};

export default SettingsWindow;
