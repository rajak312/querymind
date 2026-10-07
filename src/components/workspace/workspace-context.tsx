"use client";

import Papa from "papaparse";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { toast } from "sonner";
import type { PromptSchema } from "@/lib/agent/events";
import { createToolExecutor } from "@/lib/agent/executor";
import { runAgentLoop } from "@/lib/agent/loop";
import {
  createAgentStore,
  createConversation,
  initialAgentState,
  isBusy,
  type AgentState,
  type AgentStore,
} from "@/lib/agent/state";
import { inferTable } from "@/lib/csv/infer";
import { DATASETS, getDatasetMeta, type DatasetMeta } from "@/lib/datasets";
import { getDatabaseClient } from "@/lib/db/client";
import type { DatabaseSchema } from "@/lib/db/types";
import {
  deleteConversation as removeConversation,
  listConversations,
  loadConversation,
  saveConversation,
  type ConversationSummary,
} from "@/lib/storage/conversations";
import { newId } from "@/lib/utils";

export type AiStatus =
  { state: "loading" } | { state: "ready" | "mock"; model: string } | { state: "missing_api_key" } | { state: "error" };

export type SchemaState =
  { status: "loading" } | { status: "ready"; schema: DatabaseSchema } | { status: "error"; error: string };

export type WorkspaceTab = "chat" | "editor";

interface WorkspaceContextValue {
  ai: AiStatus;
  dataset: DatasetMeta;
  schemaState: SchemaState;
  tab: WorkspaceTab;
  setTab: (tab: WorkspaceTab) => void;
  selectDataset: (id: string) => void;
  reloadSchema: () => void;

  agent: AgentState;
  conversations: ConversationSummary[];
  ask: (text: string) => void;
  stop: () => void;
  newChat: () => void;
  openConversation: (id: string) => void;
  deleteConversation: (id: string) => void;

  editorSql: string;
  setEditorSql: (sql: string) => void;
  openInEditor: (sql: string) => void;
  /** Insert a table/column name into whichever input is active. */
  insertText: (text: string) => void;
  registerInsertTarget: (tab: WorkspaceTab, fn: ((text: string) => void) | null) => void;

  uploadFiles: (files: File[]) => Promise<void>;
  dropUploadedTable: (name: string) => Promise<void>;
  uploading: boolean;
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

const DATASET_KEY = "querymind:dataset";
const SCHEMA_LOADING: SchemaState = { status: "loading" };
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

function defaultSql(schema: DatabaseSchema | undefined): string {
  const table = schema?.tables[0];
  return table ? `SELECT *\nFROM ${table.name}\nLIMIT 100;` : "SELECT 1 AS hello;";
}

export function toPromptSchema(schema: DatabaseSchema): PromptSchema {
  return {
    tables: schema.tables.map((t) => ({
      name: t.name,
      description: t.description,
      rowCount: t.rowCount,
      columns: t.columns.map((c) => ({
        name: c.name,
        type: c.type,
        primaryKey: c.primaryKey,
        references: c.references,
        description: c.description,
      })),
      sampleRows: t.sampleRows
        .slice(0, 3)
        .map((r) => r.map((v) => (typeof v === "string" && v.length > 200 ? v.slice(0, 200) : v))),
    })),
  };
}

export function WorkspaceProvider({
  initialDatasetId,
  children,
}: {
  initialDatasetId?: string;
  children: React.ReactNode;
}) {
  const db = getDatabaseClient();
  const [ai, setAi] = useState<AiStatus>({ state: "loading" });
  const [datasetId, setDatasetId] = useState<string>(() => {
    if (initialDatasetId && getDatasetMeta(initialDatasetId)) return initialDatasetId;
    if (typeof window !== "undefined") {
      const saved = window.localStorage.getItem(DATASET_KEY);
      if (saved && getDatasetMeta(saved)) return saved;
    }
    return DATASETS[0]!.id;
  });
  const [schemaVersion, setSchemaVersion] = useState(0);
  // Schema state is keyed by dataset + version, so switching datasets reads as "loading" without an extra render.
  const schemaKey = `${datasetId}:${schemaVersion}`;
  const [loadedSchema, setLoadedSchema] = useState<{ key: string; state: SchemaState } | null>(null);
  const schemaState: SchemaState = loadedSchema?.key === schemaKey ? loadedSchema.state : SCHEMA_LOADING;
  const [tab, setTab] = useState<WorkspaceTab>("chat");
  const [editorSql, setEditorSql] = useState<string>("");
  const [conversations, setConversations] = useState<ConversationSummary[]>(() => listConversations());
  const [uploading, setUploading] = useState(false);

  const [store, setStore] = useState<AgentStore>(() =>
    createAgentStore(initialAgentState(createConversation(newId(), datasetId, Date.now()))),
  );
  const agent = useSyncExternalStore(store.subscribe, store.getState, store.getState);
  const abortRef = useRef<AbortController | null>(null);
  const insertTargets = useRef<Partial<Record<WorkspaceTab, (text: string) => void>>>({});
  const schemaRef = useRef<DatabaseSchema | undefined>(undefined);

  const dataset = getDatasetMeta(datasetId) ?? DATASETS[0]!;

  // AI availability ---------------------------------------------------------
  useEffect(() => {
    let cancelled = false;
    fetch("/api/status")
      .then((r) => r.json() as Promise<{ ai: "ready" | "mock" | "missing_api_key"; model: string }>)
      .then((s) => {
        if (cancelled) return;
        setAi(s.ai === "missing_api_key" ? { state: "missing_api_key" } : { state: s.ai, model: s.model });
      })
      .catch(() => !cancelled && setAi({ state: "error" }));
    return () => {
      cancelled = true;
    };
  }, []);

  // Load the dataset into PGlite ---------------------------------------------
  useEffect(() => {
    let cancelled = false;
    schemaRef.current = undefined;
    window.localStorage.setItem(DATASET_KEY, datasetId);
    db.open(datasetId).then(
      (schema) => {
        if (cancelled) return;
        schemaRef.current = schema;
        setLoadedSchema({ key: schemaKey, state: { status: "ready", schema } });
        setEditorSql((current) => current || defaultSql(schema));
      },
      (error: Error) =>
        !cancelled && setLoadedSchema({ key: schemaKey, state: { status: "error", error: error.message } }),
    );
    return () => {
      cancelled = true;
    };
  }, [db, datasetId, schemaKey]);

  // Persist the active conversation whenever its committed state changes -----
  const conversation = agent.conversation;
  useEffect(() => {
    if (conversation.messages.length === 0) return;
    const timer = setTimeout(() => setConversations(saveConversation(conversation)), 250);
    return () => clearTimeout(timer);
  }, [conversation]);

  const abortRun = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
  }, []);

  const startFresh = useCallback(
    (nextDatasetId: string) => {
      abortRun();
      setStore(createAgentStore(initialAgentState(createConversation(newId(), nextDatasetId, Date.now()))));
    },
    [abortRun],
  );

  const selectDataset = useCallback(
    (id: string) => {
      if (id === datasetId) return;
      setDatasetId(id);
      setEditorSql("");
      startFresh(id);
    },
    [datasetId, startFresh],
  );

  const newChat = useCallback(() => {
    startFresh(datasetId);
    setTab("chat");
  }, [datasetId, startFresh]);

  const openConversation = useCallback(
    (id: string) => {
      const loaded = loadConversation(id);
      if (!loaded) {
        toast.error("That conversation could not be loaded.");
        setConversations(removeConversation(id));
        return;
      }
      abortRun();
      if (loaded.datasetId !== datasetId) {
        setDatasetId(loaded.datasetId);
        setEditorSql("");
      }
      setStore(createAgentStore(initialAgentState(loaded)));
      setTab("chat");
    },
    [abortRun, datasetId],
  );

  const deleteConversation = useCallback(
    (id: string) => {
      setConversations(removeConversation(id));
      if (store.getState().conversation.id === id) startFresh(datasetId);
    },
    [datasetId, startFresh, store],
  );

  const ask = useCallback(
    (text: string) => {
      const question = text.trim();
      const schema = schemaRef.current;
      if (!question || isBusy(store.getState().status) || !schema) return;
      const controller = new AbortController();
      abortRef.current = controller;
      store.dispatch({ type: "user_message", text: question, now: Date.now() });
      const activeDataset = getDatasetMeta(store.getState().conversation.datasetId) ?? dataset;
      const promptSchema = toPromptSchema(schema);
      void runAgentLoop({
        store,
        signal: controller.signal,
        buildRequest: () => ({
          datasetId: activeDataset.id,
          dataset: { name: activeDataset.name, description: activeDataset.description },
          schema: promptSchema,
        }),
        executeTool: createToolExecutor({
          query: (sql, maxRows) => db.query(activeDataset.id, sql, maxRows),
          profile: (table) => db.profile(activeDataset.id, table),
        }),
      }).finally(() => {
        if (abortRef.current === controller) abortRef.current = null;
      });
    },
    [dataset, db, store],
  );

  const stop = useCallback(() => abortRun(), [abortRun]);

  const openInEditor = useCallback((sql: string) => {
    setEditorSql(sql.trim());
    setTab("editor");
  }, []);

  const registerInsertTarget = useCallback((target: WorkspaceTab, fn: ((text: string) => void) | null) => {
    if (fn) insertTargets.current[target] = fn;
    else delete insertTargets.current[target];
  }, []);

  const insertText = useCallback(
    (text: string) => {
      const fn = insertTargets.current[tab];
      if (fn) fn(text);
    },
    [tab],
  );

  const uploadFiles = useCallback(
    async (files: File[]) => {
      setUploading(true);
      try {
        for (const file of files) {
          if (file.size > MAX_UPLOAD_BYTES) {
            toast.error(`${file.name} is larger than 25 MB.`);
            continue;
          }
          const text = await file.text();
          const parsed = Papa.parse<string[]>(text, { skipEmptyLines: "greedy" });
          if (parsed.data.length < 2) {
            toast.error(`${file.name} has no data rows.`);
            continue;
          }
          const table = inferTable(file.name, parsed.data);
          const { schema, tableName } = await db.importTable(table, file.name);
          if (datasetId === "uploads") {
            schemaRef.current = schema;
            setLoadedSchema({ key: schemaKey, state: { status: "ready", schema } });
          }
          toast.success(`Created table ${tableName}`, {
            description: `${table.rows.length.toLocaleString("en-US")} rows · ${table.columns.length} columns`,
          });
        }
        if (datasetId !== "uploads") selectDataset("uploads");
      } catch (error) {
        toast.error("Upload failed", { description: error instanceof Error ? error.message : String(error) });
      } finally {
        setUploading(false);
      }
    },
    [datasetId, db, schemaKey, selectDataset],
  );

  const dropUploadedTable = useCallback(
    async (name: string) => {
      try {
        const schema = await db.dropTable(name);
        schemaRef.current = schema;
        setLoadedSchema({ key: schemaKey, state: { status: "ready", schema } });
        toast.success(`Deleted table ${name}`);
      } catch (error) {
        toast.error("Could not delete table", { description: error instanceof Error ? error.message : String(error) });
      }
    },
    [db, schemaKey],
  );

  const value = useMemo<WorkspaceContextValue>(
    () => ({
      ai,
      dataset,
      schemaState,
      tab,
      setTab,
      selectDataset,
      reloadSchema: () => setSchemaVersion((v) => v + 1),
      agent,
      conversations,
      ask,
      stop,
      newChat,
      openConversation,
      deleteConversation,
      editorSql,
      setEditorSql,
      openInEditor,
      insertText,
      registerInsertTarget,
      uploadFiles,
      dropUploadedTable,
      uploading,
    }),
    [
      ai,
      dataset,
      schemaState,
      tab,
      selectDataset,
      agent,
      conversations,
      ask,
      stop,
      newChat,
      openConversation,
      deleteConversation,
      editorSql,
      openInEditor,
      insertText,
      registerInsertTarget,
      uploadFiles,
      dropUploadedTable,
      uploading,
    ],
  );

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace(): WorkspaceContextValue {
  const value = useContext(WorkspaceContext);
  if (!value) throw new Error("useWorkspace must be used inside <WorkspaceProvider>");
  return value;
}
