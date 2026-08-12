"use client";

import { Box, Button, Flex, Heading, Link, Text } from "@chakra-ui/react";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

type RoleKey = "fundamental" | "technical" | "synthesis";
type Roles = Record<RoleKey, string | null>;
type HistoryItem = { id: string; ticker?: string; title?: string; kind: "notes" | "analysis"; createdAt: number };

const ROLE_LABEL: Record<RoleKey, string> = {
  fundamental: "Fundamental skill",
  technical: "Technical skill",
  synthesis: "Brain synthesis",
};

export default function Sidebar({ isOpen = false, onClose }: { isOpen?: boolean; onClose?: () => void }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [roles, setRoles] = useState<Roles | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);

  const refresh = () => {
    fetch("/api/roles").then((r) => r.json()).then(setRoles).catch(() => {});
    fetch("/api/analyses").then((r) => r.json()).then((d) => setHistory(Array.isArray(d) ? d : [])).catch(() => {});
  };
  useEffect(refresh, []);

  const missing = roles
    ? (Object.entries(roles).filter(([, v]) => !v).map(([k]) => k) as RoleKey[])
    : [];

  const go = (path: string) => {
    router.push(path);
    onClose?.();
  };

  // Removes an analysis from history. If it's the one currently open, navigate
  // back to a fresh analysis so the chat doesn't keep showing a deleted body.
  const remove = async (h: HistoryItem) => {
    const label = h.ticker ? h.ticker.toUpperCase() : h.title || h.kind;
    if (!window.confirm(`Remove "${label}" from history?`)) return;
    try {
      await fetch(`/api/analyses?id=${encodeURIComponent(h.id)}`, { method: "DELETE" });
    } catch {
      // Network failure: leave the row in place and let the user retry.
      return;
    }
    if (searchParams.get("id") === h.id) {
      router.push("/");
      onClose?.();
    }
    refresh();
  };

  const content = (
    <Flex flexDir="column" h="100%">
      <Flex align="center" justify="space-between" p={4}>
        <Heading size="sm" color="ink" fontWeight="semibold">Research Tool</Heading>
        <Link href="/settings" aria-label="Settings" color="muted" _hover={{ color: "ink" }} onClick={() => go("/settings")}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
        </Link>
      </Flex>

      <Box px={3} pb={2}>
        <Button w="full" colorScheme="accent" size="sm" onClick={() => go("/")}>
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" style={{ marginRight: 6 }}>
            <path d="M6 1v10M1 6h10" />
          </svg>
          New analysis
        </Button>
        <Button w="full" variant="ghost" color="muted" size="sm" justifyContent="flex-start" mt={1} onClick={() => go("/market")}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ marginRight: 6 }}>
            <path d="M3 3v18h18" />
            <path d="M7 14l4-6 3 3 5-7" />
          </svg>
          Iran Stocks Data
        </Button>
      </Box>

      {missing.length > 0 && (
        <Box mx={3} mb={2} p={2} borderWidth="1px" borderColor="yellow.600/40" bg="yellow.950/40" rounded="md" fontSize="xs" color="yellow.300">
          <Text fontWeight="medium" mb={1}>Roles without an endpoint:</Text>
          <Box as="ul" listStylePos="inside" listStyleType="disc" pl={2} mb={0} spaceY={0.5}>
            {missing.map((k) => (
              <Box as="li" key={k}>{ROLE_LABEL[k]}</Box>
            ))}
          </Box>
          <Link href="/settings" mt={1} display="inline-block" textDecoration="underline" onClick={() => onClose?.()}>
            Configure in Settings →
          </Link>
        </Box>
      )}

      <Box as="nav" flex="1" overflowY="auto" px={3} py={2}>
        {history.length === 0 && <Text px={1} fontSize="xs" color="muted">No analyses yet.</Text>}
        <Flex flexDir="column" gap={1} align="stretch">
          {history.map((h) => (
            <Flex key={h.id} align="center" gap={0.5}>
              <Button
                onClick={() => go(`/?id=${h.id}`)}
                variant="ghost"
                justifyContent="flex-start"
                size="sm"
                color="ink"
                _hover={{ bg: "raised" }}
                flex="1"
              >
                <Text as="span" fontWeight="medium" truncate>
                  {h.ticker ? h.ticker.toUpperCase() : h.title || h.kind}
                </Text>
                <Text as="span" ml={2} fontSize="xs" color="muted">
                  {h.kind === "analysis" ? "analysis" : "notes"}
                </Text>
                <Text as="span" ml={1} fontSize="10px" color="muted">
                  {new Date(h.createdAt).toLocaleDateString()}
                </Text>
              </Button>
              <Box
                as="button"
                onClick={() => remove(h)}
                aria-label={`Remove ${h.ticker || h.title || "this analysis"}`}
                title="Remove from history"
                color="muted"
                p={1}
                rounded="md"
                flexShrink={0}
                _hover={{ color: "red.400", bg: "raised" }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 6h18" />
                  <path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2" />
                  <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                  <line x1="10" y1="11" x2="10" y2="17" />
                  <line x1="14" y1="11" x2="14" y2="17" />
                </svg>
              </Box>
            </Flex>
          ))}
        </Flex>
      </Box>

      <Box borderTopWidth="1px" borderColor="borderC" px={4} py={3} fontSize="11px" color="muted">
        Research tool, not financial advice — all outputs are estimates based on assumptions you can inspect.
      </Box>
    </Flex>
  );

  return (
    <>
      {/* Desktop / tablet: static side rail */}
      <Box as="aside" display={{ base: "none", md: "flex" }} w="260px" h="100vh" borderRightWidth="1px" borderColor="borderC" bg="surface" overflowY="hidden">
        {content}
      </Box>

      {/* Mobile: slide-in drawer with overlay */}
      {isOpen && (
        <>
          <Box
            onClick={onClose}
            position="fixed"
            inset="0"
            bg="blackAlpha.600"
            zIndex={100}
            display={{ base: "block", md: "none" }}
          />
          <Box
            as="aside"
            position="fixed"
            left="0"
            top="0"
            bottom="0"
            w="280px"
            maxW="80vw"
            bg="surface"
            borderRightWidth="1px"
            borderColor="borderC"
            zIndex={101}
            display={{ base: "flex", md: "none" }}
            flexDir="column"
          >
            {content}
          </Box>
        </>
      )}
    </>
  );
}