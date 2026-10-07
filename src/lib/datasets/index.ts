import { ecommerceDataset } from "./ecommerce";
import { saasDataset } from "./saas";
import type { BuiltinDataset, DatasetMeta } from "./types";

export const BUILTIN_DATASETS: BuiltinDataset[] = [ecommerceDataset, saasDataset];

export const UPLOADS_DATASET: DatasetMeta = {
  id: "uploads",
  name: "My data",
  tagline: "Your CSV files",
  description: "Tables created from CSV files you upload. They stay in this browser.",
  suggestions: [
    "Give me an overview of the tables I uploaded.",
    "What are the most interesting patterns in this data?",
    "Which columns have missing values, and how many?",
  ],
};

export const DATASETS: DatasetMeta[] = [...BUILTIN_DATASETS, UPLOADS_DATASET];

export function getDatasetMeta(id: string): DatasetMeta | undefined {
  return DATASETS.find((d) => d.id === id);
}

export function getBuiltinDataset(id: string): BuiltinDataset | undefined {
  return BUILTIN_DATASETS.find((d) => d.id === id);
}

export type { BuiltinDataset, DatasetMeta } from "./types";
