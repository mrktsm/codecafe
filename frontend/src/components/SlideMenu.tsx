import { useState, useEffect, useRef } from "react";
import { Card } from "@radix-ui/themes";
import * as ContextMenu from "@radix-ui/react-context-menu";
import { IoIosAddCircleOutline } from "react-icons/io";

const SlideMenu = () => {
  const [isVisible, setIsVisible] = useState(false);
  const [shadowIntensity, setShadowIntensity] = useState(0);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const handleMouseMove = (e: any) => {
      if (menuRef.current) {
        const menuRect = menuRef.current.getBoundingClientRect();
        const isInsideMenu =
          e.clientX >= menuRect.left &&
          e.clientX <= menuRect.right &&
          e.clientY >= menuRect.top &&
          e.clientY <= menuRect.bottom;

        const shouldBeVisible = e.clientX <= 50 || isInsideMenu;
        setIsVisible(shouldBeVisible);

        // Only show shadow when menu is hidden AND mouse is in trigger zone
        if (!shouldBeVisible && e.clientX <= 200 && e.clientX >= 0) {
          const normalizedPosition = (200 - e.clientX) / 200;
          const exponentialIntensity = Math.pow(normalizedPosition, 3) * 100;
          setShadowIntensity(exponentialIntensity);
        } else {
          setShadowIntensity(0);
        }
      }
    };

    const handleMouseLeave = () => {
      if (!menuRef.current?.contains(document.activeElement)) {
        setIsVisible(false);
        setShadowIntensity(0);
      }
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseleave", handleMouseLeave);

    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseleave", handleMouseLeave);
    };
  }, []);

  return (
    <div
      ref={menuRef}
      style={{
        boxShadow:
          shadowIntensity > 0 && !isVisible
            ? `${shadowIntensity * 1}px 0 ${
                shadowIntensity * 1.5
              }px rgba(0, 0, 0, ${shadowIntensity * 0.01})`
            : "none",
        position: "fixed",
        left: 0,
        top: 0,
        height: "100vh",
        zIndex: 50,
        transform: `translateX(${isVisible ? "0" : "-100%"})`,
        transition: `
          transform ${
            isVisible
              ? "400ms cubic-bezier(0.16, 1, 0.3, 1)"
              : "300ms cubic-bezier(0.7, 0, 0.84, 0)"
          }, 
          box-shadow 150ms ease-out
        `,
      }}
    >
      <Card className="h-full w-64 bg-neutral-900/40 backdrop-blur-xl border-neutral-800/50 rounded-r-xl">
        <div className="space-y-6 py-4">
          <div className="px-2">
            <button className="mt-8 flex items-center gap-2 w-full py-2 px-2 rounded-md transition-colors duration-200 bg-transparent hover:bg-neutral-900 active:bg-stone-950 text-stone-500 hover:text-stone-400">
              <IoIosAddCircleOutline className="w-5 h-5" />
              <span className="text-sm">New</span>
            </button>
          </div>
          <div className="space-y-2 px-4">
            <h2 className="text-sm font-medium text-stone-400">Starred</h2>
            <ContextMenu.Root>
              <ContextMenu.Trigger>
                <div className="px-4 py-8 border border-dashed border-neutral-700 rounded-lg text-[10px] text-stone-400 text-center">
                  Star code spaces you use often
                </div>
              </ContextMenu.Trigger>
              <ContextMenu.Content className="min-w-[220px] bg-neutral-900 rounded-lg p-1 shadow-xl"></ContextMenu.Content>
            </ContextMenu.Root>
          </div>
          <div className="space-y-2 px-4">
            <h2 className="text-sm font-medium text-stone-400">Recent</h2>
            <ContextMenu.Root>
              <ContextMenu.Trigger>
                <div className="px-4 py-8 border border-dashed border-neutral-700 rounded-lg text-[10px] text-stone-400 text-center">
                  Recent code spaces will appear here
                </div>
              </ContextMenu.Trigger>
              <ContextMenu.Content className="min-w-[220px] bg-neutral-900 rounded-lg p-1 shadow-xl">
                <ContextMenu.Item className="text-sm text-stone-400 hover:text-stone-200 hover:bg-neutral-800 rounded-md px-2 py-1.5 outline-none cursor-default">
                  No recent code spaces
                </ContextMenu.Item>
              </ContextMenu.Content>
            </ContextMenu.Root>
          </div>
        </div>
      </Card>
    </div>
  );
};

export default SlideMenu;
