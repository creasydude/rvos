"use client";

import { ChakraProvider, createSystem, defaultConfig, defineConfig, defineTokens } from "@chakra-ui/react";

// Custom dark theme: starts from Chakra's full default config (all color
// scales, recipes, preflight) and overrides the app's palette on top.
// IMPORTANT: createSystem(defaultConfig, myConfig) MERGES; createSystem(myConfig)
// alone would discard the whole default theme and break every component.
const colors = defineTokens.colors({
  accent: {
    50: { value: "#f0eeff" },
    100: { value: "#dcd7ff" },
    200: { value: "#c2baff" },
    300: { value: "#a79bff" },
    400: { value: "#8a7dff" },
    500: { value: "#7a6cf0" },
    600: { value: "#6859d8" },
    700: { value: "#5648b5" },
    800: { value: "#453a92" },
    900: { value: "#352c70" },
  },
});

const config = defineConfig({
  globalCss: {
    body: {
      bg: "bg",
      color: "fg",
    },
  },
  theme: {
    tokens: {
      colors,
    },
    semanticTokens: {
      colors: {
        bg: { value: "#17171c" },
        surface: { value: "#202028" },
        raised: { value: "#2a2a33" },
        borderC: { value: "#3a3a45" },
        ink: { value: "#e8e8ec" },
        muted: { value: "#a0a0ac" },
        // reuse the accent scale so colorScheme="accent" resolves
        accent: { value: "{colors.accent.400}" },
      },
    },
  },
});

const system = createSystem(defaultConfig, config);

export default function Providers({ children }: { children: React.ReactNode }) {
  return <ChakraProvider value={system}>{children}</ChakraProvider>;
}
