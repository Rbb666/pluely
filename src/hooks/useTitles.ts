import { useEffect } from "react";

/** Keep native hover descriptions available, including dynamically added icons. */
export const useTitles = () => {
  useEffect(() => {
    document.documentElement.removeAttribute("data-titles-disabled");
    document.documentElement.setAttribute("data-titles-enabled", "true");

    // Restore titles removed by the previous implementation during a hot update.
    document.querySelectorAll("[data-original-title]").forEach((element) => {
      if (!element.hasAttribute("title")) {
        const title = element.getAttribute("data-original-title");
        if (title) element.setAttribute("title", title);
      }
      element.removeAttribute("data-original-title");
    });
  }, []);

  return {
    getTitle: (titleText = ""): string => titleText,
    isTitlesEnabled: true,
  };
};
