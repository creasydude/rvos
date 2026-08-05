"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  Box, Button, DialogBackdrop, DialogBody, DialogCloseTrigger, DialogContent, DialogFooter,
  DialogHeader, DialogRoot, DialogTitle, Flex, Heading, Input, NativeSelectField, NativeSelectRoot,
  Text, VStack, useDisclosure,
} from "@chakra-ui/react";

type Provider = "openai" | "openai-compatible" | "anthropic" | "gemini";

const PROVIDERS: { value: Provider; label: string }[] = [
  { value: "openai", label: "OpenAI" },
  { value: "openai-compatible", label: "OpenAI-compatible (custom base URL)" },
  { value: "anthropic", label: "Anthropic (OpenAI-compat)" },
  { value: "gemini", label: "Google Gemini (OpenAI-compat)" },
];

type Endpoint = {
  id: string;
  name: string;
  provider: Provider;
  baseUrl?: string;
  model: string;
};

type Roles = Record<"fundamental" | "technical" | "synthesis", string | null>;

const ROLE_LABEL: Record<keyof Roles, string> = {
  fundamental: "Fundamental skill",
  technical: "Technical skill",
  synthesis: "Brain synthesis",
};

const ROLE_DESC: Record<keyof Roles, string> = {
  fundamental: "Reformats pasted fundamental data into structured notes",
  technical: "Reformats pasted chart/price data into structured notes",
  synthesis: "Writes the final bear/base/bull write-up from brain numbers",
};

type Form = {
  id?: string;
  name: string;
  provider: Provider;
  baseUrl: string;
  model: string;
  apiKey: string;
};

const EMPTY: Form = { name: "", provider: "openai", baseUrl: "", model: "", apiKey: "" };

export default function SettingsPage() {
  const [endpoints, setEndpoints] = useState<Endpoint[]>([]);
  const [roles, setRoles] = useState<Roles | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [showKeyForm, setShowKeyForm] = useState(false);
  const { open, onOpen, onClose } = useDisclosure();

  const refresh = async () => {
    const [eps, rls] = await Promise.all([
      fetch("/api/endpoints").then((r) => r.json()),
      fetch("/api/roles").then((r) => r.json()),
    ]);
    if (Array.isArray(eps)) setEndpoints(eps);
    if (rls && typeof rls === "object") setRoles(rls as Roles);
  };

  useEffect(() => {
    refresh().catch(() => {});
  }, []);

  const flash = (m: string) => {
    setMsg(m);
    setTimeout(() => setMsg(null), 3000);
  };

  const openAdd = () => {
    setForm({ ...EMPTY });
    setShowKeyForm(true);
    onOpen();
  };
  const openEdit = (ep: Endpoint) => {
    setForm({ id: ep.id, name: ep.name, provider: ep.provider, baseUrl: ep.baseUrl ?? "", model: ep.model, apiKey: "" });
    setShowKeyForm(false);
    onOpen();
  };

  const submit = async () => {
    if (!form) return;
    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        name: form.name,
        provider: form.provider,
        model: form.model,
      };
      if (form.baseUrl.trim()) payload.baseUrl = form.baseUrl.trim();
      if (showKeyForm && form.apiKey.trim()) payload.apiKey = form.apiKey.trim();
      if (form.id) payload.id = form.id;

      const res = await fetch("/api/endpoints", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Save failed");
      flash("Saved");
      onClose();
      setForm(null);
      await refresh();
    } catch (e) {
      flash((e as Error).message);
    }
    setSaving(false);
  };

  const remove = async (id: string) => {
    await fetch(`/api/endpoints?id=${id}`, { method: "DELETE" });
    await refresh();
    flash("Deleted");
  };

  const setRole = async (role: keyof Roles, endpointId: string) => {
    await fetch("/api/roles", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ [role]: endpointId || null }),
    });
    await refresh();
  };

  return (
    <Box maxW="720px" mx="auto" px={4} py={8} color="ink">
      <Flex mb={6} align="center" justify="space-between">
        <Heading size="lg">Settings</Heading>
        <Link href="/" style={{ color: "#a0a0ac", textDecoration: "none" }} onMouseEnter={(e) => (e.currentTarget.style.color = "#e8e8ec")} onMouseLeave={(e) => (e.currentTarget.style.color = "#a0a0ac")}>
          ← Back to chat
        </Link>
      </Flex>

      {msg && (
        <Box mb={4} p={2} borderWidth="1px" borderColor="accent/40" bg="accent/10" rounded="md" fontSize="sm" color="ink">
          {msg}
        </Box>
      )}

      {/* Endpoints */}
      <Box mb={8}>
        <Flex mb={2} align="center" justify="space-between">
          <Heading size="sm">Endpoints</Heading>
          <Button size="xs" variant="outline" borderColor="borderC" onClick={openAdd}>
            Add endpoint
          </Button>
        </Flex>

        {endpoints.length === 0 && <Text fontSize="sm" color="muted">No endpoints yet. Add one to get started.</Text>}

        <VStack align="stretch" spaceY={2}>
          {endpoints.map((ep) => (
            <Box key={ep.id} p={3} borderWidth="1px" borderColor="borderC" rounded="md" bg="surface">
              <Flex align="center" justify="space-between">
                <Box>
                  <Text as="span" fontWeight="medium">{ep.name}</Text>
                  <Text as="span" ml={2} fontSize="xs" color="muted">{ep.model}</Text>
                </Box>
                <Flex gap={2}>
                  <Button size="xs" variant="ghost" color="muted" onClick={() => openEdit(ep)}>
                    Edit
                  </Button>
                  <Button size="xs" variant="ghost" color="red.400" onClick={() => remove(ep.id)}>
                    Delete
                  </Button>
                </Flex>
              </Flex>
              <Text mt={1} fontSize="xs" color="muted">
                {PROVIDERS.find((p) => p.value === ep.provider)?.label ?? ep.provider}
                {ep.baseUrl && ` · ${ep.baseUrl}`}
                <Box as="span" ml={2} color="green.400">api key •••• saved</Box>
              </Text>
            </Box>
          ))}
        </VStack>
      </Box>

      {/* Role assignment */}
      <Box>
        <Heading size="sm" mb={2}>Role assignment</Heading>
        <Text mb={3} fontSize="xs" color="muted">Route each pipeline stage to the endpoint you want.</Text>
        {roles && (
          <VStack align="stretch" spaceY={3}>
            {(Object.keys(ROLE_LABEL) as (keyof Roles)[]).map((role) => (
              <Box key={role} p={3} borderWidth="1px" borderColor="borderC" rounded="md" bg="surface">
                <Text fontWeight="medium" mb={1}>{ROLE_LABEL[role]}</Text>
                <Text mb={2} fontSize="xs" color="muted">{ROLE_DESC[role]}</Text>
                <NativeSelectRoot size="sm">
                  <NativeSelectField
                    value={roles[role] ?? ""}
                    onChange={(e) => setRole(role, e.target.value)}
                    bg="bg"
                    borderColor="borderC"
                    color="ink"
                  >
                    <option value="">— none assigned —</option>
                    {endpoints.map((ep) => (
                      <option key={ep.id} value={ep.id}>
                        {ep.name} ({ep.model})
                      </option>
                    ))}
                  </NativeSelectField>
                </NativeSelectRoot>
              </Box>
            ))}
          </VStack>
        )}
      </Box>

      <Box mt={8} borderTopWidth="1px" borderColor="borderC" pt={4} fontSize="11px" color="muted">
        Research tool, not financial advice — all outputs are estimates based on assumptions you can inspect.
      </Box>

      {/* Add/edit dialog */}
      <DialogRoot open={open} onOpenChange={(d) => !d.open && onClose()}>
        <DialogBackdrop bg="blackAlpha.700" />
        <DialogContent bg="surface" color="ink" borderWidth="1px" borderColor="borderC">
          <DialogHeader>
            <DialogTitle>{form?.id ? "Edit endpoint" : "Add endpoint"}</DialogTitle>
          </DialogHeader>
          <DialogBody>
            <VStack spaceY={3} align="stretch">
              <Field label="Name">
                <Input value={form?.name ?? ""} onChange={(e) => setForm({ ...form!, name: e.target.value })} bg="bg" borderColor="borderC" placeholder="e.g. My GPT-4o key" />
              </Field>
              <Field label="Provider">
                <NativeSelectRoot>
                  <NativeSelectField
                    value={form?.provider ?? "openai"}
                    onChange={(e) => setForm({ ...form!, provider: e.target.value as Provider })}
                    bg="bg"
                    borderColor="borderC"
                  >
                    {PROVIDERS.map((p) => (
                      <option key={p.value} value={p.value}>{p.label}</option>
                    ))}
                  </NativeSelectField>
                </NativeSelectRoot>
              </Field>
              {(form?.provider === "openai-compatible" || form?.baseUrl) && (
                <Field label="Base URL">
                  <Input value={form?.baseUrl ?? ""} onChange={(e) => setForm({ ...form!, baseUrl: e.target.value })} bg="bg" borderColor="borderC" placeholder="https://your-endpoint.example.com/v1" />
                </Field>
              )}
              <Field label="Model">
                <Input value={form?.model ?? ""} onChange={(e) => setForm({ ...form!, model: e.target.value })} bg="bg" borderColor="borderC" placeholder="e.g. gpt-4o" />
              </Field>
              <Field label={form?.id && !showKeyForm ? "API key (saved)" : "API key"}>
                {form?.id && !showKeyForm ? (
                  <Flex align="center" gap={2}>
                    <Text fontSize="sm" color="muted">•••••••• saved</Text>
                    <Button size="xs" variant="plain" color="accent" onClick={() => setShowKeyForm(true)}>
                      Replace
                    </Button>
                  </Flex>
                ) : (
                  <Input type="password" value={form?.apiKey ?? ""} onChange={(e) => setForm({ ...form!, apiKey: e.target.value })} bg="bg" borderColor="borderC" placeholder={form?.id ? "Leave blank to keep current" : "sk-…"} />
                )}
              </Field>
            </VStack>
          </DialogBody>
          <DialogFooter gap={2}>
            <Button variant="ghost" color="muted" onClick={onClose}>
              Cancel
            </Button>
            <Button colorScheme="accent" onClick={submit} disabled={saving || !form?.name || !form?.model}>
              {saving ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
          <DialogCloseTrigger />
        </DialogContent>
      </DialogRoot>
    </Box>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Box>
      <Text mb={1} fontSize="xs" fontWeight="medium" color="muted">{label}</Text>
      {children}
    </Box>
  );
}
